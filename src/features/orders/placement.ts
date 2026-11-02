import "server-only";

import { getCheckoutPolicy, minutesToMs } from "@/config/checkout-policy";
import type { Prisma } from "@/generated/prisma/client";
import type {
  AddressSnapshot,
  CheckoutCustomer,
} from "@/features/checkout/types";
import { commitForOrder, reserveForOrder } from "@/features/inventory/service";
import { enqueueOrderConfirmed } from "@/server/notifications/outbox";

import * as data from "./data";
import { generateOrderNumber } from "./order-number";
import {
  assertPlacementInput,
  initialOrderStatus,
  orderTaxInPaise,
} from "./placement-rules";
import type { PlacementRules } from "./placement-rules";

/**
 * Creates an order with its items, stock handling, first payment attempt,
 * event and confirmation e-mail inside the caller's transaction (Phase 8
 * step 8.0). Extracted from checkout placement without behaviour change so
 * that exchange settlement and commission acceptance create orders through
 * the same path. The caller holds the locks the lock order requires
 * (docs/checkout.md §5.5): the cart for checkout, the parent order for a
 * replacement or an instalment.
 */

export interface PlacementInput extends PlacementRules {
  readonly customer: CheckoutCustomer;
  readonly address: AddressSnapshot;
  readonly customerNote: string | null;
  /** The cart that was converted, for the one-live-order-per-cart index; null otherwise. */
  readonly cartId: string | null;
  readonly now: Date;
}

export interface PlacementResult {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: "PENDING_PAYMENT" | "CONFIRMED";
  /** The first online attempt, or null for cash on delivery and store credit. */
  readonly attemptId: string | null;
  readonly pendingExpiresAt: Date | null;
}

export async function createOrderFromLines(
  tx: Prisma.TransactionClient,
  input: PlacementInput,
): Promise<PlacementResult> {
  assertPlacementInput(input);
  const policy = getCheckoutPolicy();
  const status = initialOrderStatus(input.paymentMethod);
  const orderNumber = generateOrderNumber();
  const pendingExpiresAt =
    status === "PENDING_PAYMENT"
      ? new Date(
          input.now.getTime() + minutesToMs(policy.reservation.ttlMinutes),
        )
      : null;
  const items = input.lines.map((line) => ({
    ...line,
    lineTotalInPaise: line.unitPriceInPaise * line.quantity,
  }));

  const order = await tx.order.create({
    data: {
      orderNumber,
      kind: input.kind,
      exchangeOfOrderId: input.links.exchangeOfOrderId,
      commissionRequestId: input.links.commissionRequestId,
      instalment: input.links.instalment,
      userId: input.customer.userId,
      email: input.customer.email,
      phone: input.customer.phone,
      status,
      paymentMethod: input.paymentMethod,
      currency: policy.payment.currency,
      subtotalInPaise: input.amounts.subtotalInPaise,
      shippingInPaise: input.amounts.shippingInPaise,
      codFeeInPaise: input.amounts.codFeeInPaise,
      discountInPaise: input.amounts.discountInPaise,
      totalInPaise: input.amounts.totalInPaise,
      taxInPaise: orderTaxInPaise(input.lines),
      recipientName: input.address.recipientName,
      addressLine1: input.address.line1,
      addressLine2: input.address.line2,
      landmark: input.address.landmark,
      city: input.address.city,
      state: input.address.state,
      postalCode: input.address.postalCode,
      country: input.address.country,
      customerNote: input.customerNote,
      cartId: input.cartId,
      pendingExpiresAt,
      confirmedAt: status === "CONFIRMED" ? input.now : null,
      createdAt: input.now,
      items: { createMany: { data: items } },
    },
    select: { id: true },
  });

  const stockLines = items.map((item) => ({
    variantId: item.variantId,
    quantity: item.quantity,
  }));
  const manageStock = input.stock === "manage";
  const receipt = `${orderNumber}-1`;
  let attemptId: string | null = null;

  if (input.paymentMethod === "RAZORPAY") {
    if (pendingExpiresAt === null) throw new Error("unreachable");
    if (manageStock) {
      await reserveForOrder(tx, order.id, stockLines, pendingExpiresAt);
    }
    const attempt = await tx.payment.create({
      data: {
        orderId: order.id,
        attemptNo: 1,
        method: "RAZORPAY",
        status: "INITIATED",
        amountInPaise: input.amounts.totalInPaise,
        receipt,
      },
      select: { id: true },
    });
    attemptId = attempt.id;
    await data.recordOrderEvent(tx, {
      orderId: order.id,
      type: "order.placed",
      actor: "CUSTOMER",
      toStatus: "PENDING_PAYMENT",
      note: manageStock
        ? "Stock held until the payment deadline."
        : "Awaiting payment.",
      data: { pendingExpiresAt: pendingExpiresAt.toISOString() },
    });
  } else {
    if (manageStock) await commitForOrder(tx, stockLines);
    if (input.paymentMethod === "COD") {
      await tx.payment.create({
        data: {
          orderId: order.id,
          attemptNo: 1,
          method: "COD",
          status: "CREATED",
          amountInPaise: input.amounts.totalInPaise,
          receipt,
        },
      });
    }
    await data.recordOrderEvent(tx, {
      orderId: order.id,
      type: "order.placed",
      actor: "CUSTOMER",
      toStatus: "CONFIRMED",
      note:
        input.paymentMethod === "COD"
          ? manageStock
            ? "Cash on delivery; stock committed."
            : "Cash on delivery."
          : manageStock
            ? "Settled by store credit; stock committed."
            : "Settled by store credit.",
    });
    await enqueueOrderConfirmed(tx, {
      orderId: order.id,
      orderNumber,
      customerEmail: input.customer.email,
    });
  }

  return {
    orderId: order.id,
    orderNumber,
    status,
    attemptId,
    pendingExpiresAt,
  };
}
