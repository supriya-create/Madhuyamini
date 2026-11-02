import { randomUUID } from "node:crypto";

import {
  markDelivered,
  shipOrder,
  startProcessing,
} from "@/features/admin/orders/service";
import type { CurrentUser } from "@/server/auth/current-user";

import { createVariant, testDb } from "./db";
import { placeTestOrder } from "./order-fixtures";
import type { PlacedOrder } from "./order-fixtures";
import { createSession, verifiedStaff } from "./staff";
import type { StaffUserRow } from "./staff";

/**
 * Returns fixtures: a delivered cash-on-delivery order with its customer
 * signed in, optional sibling variants for exchanges, and verified
 * evidence rows in the private file ledger.
 */

export const SHIP = {
  carrier: "India Post",
  trackingNumber: "RB123456789IN",
  trackingUrl: null,
};

export async function customerFor(userId: string): Promise<CurrentUser> {
  const row = await testDb.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      name: true,
      phone: true,
      role: true,
    },
  });
  return createSession(row satisfies StaffUserRow);
}

export interface DeliveredOrder extends PlacedOrder {
  readonly customer: CurrentUser;
  readonly orderItemId: string;
  readonly productId: string;
  readonly deliveredAt: Date;
}

export async function deliveredOrder(
  options: {
    readonly sku?: string;
    readonly stock?: number;
    readonly quantity?: number;
    readonly deliveredAt?: Date;
    readonly email?: string;
  } = {},
): Promise<DeliveredOrder> {
  const staff = await verifiedStaff("STAFF");
  const placed = await placeTestOrder("COD", {
    sku: options.sku ?? "RET-1",
    stock: options.stock ?? 5,
    quantity: options.quantity ?? 2,
    ...(options.email ? { email: options.email } : {}),
  });
  await startProcessing(staff.ctx, placed.orderId);
  await shipOrder(staff.ctx, placed.orderId, SHIP);
  const deliveredAt = options.deliveredAt ?? new Date();
  await markDelivered(staff.ctx, placed.orderId, deliveredAt);
  const item = await testDb.orderItem.findFirstOrThrow({
    where: { orderId: placed.orderId },
    select: { id: true, variant: { select: { productId: true } } },
  });
  return {
    ...placed,
    customer: await customerFor(placed.userId),
    orderItemId: item.id,
    productId: item.variant.productId,
    deliveredAt,
  };
}

/** A second, in-stock variant of the same product, for exchange preferences. */
export async function siblingVariant(productId: string, sku: string) {
  const variant = await createVariant(productId, sku, 129_900);
  await testDb.productVariant.update({
    where: { id: variant.id },
    data: { title: `Variant ${sku}` },
  });
  return variant;
}

/** A verified, unattached evidence upload owned by `userId`. */
export async function verifiedEvidence(userId: string, now = new Date()) {
  const folder = `madhuyamini/returns/${userId}`;
  return testDb.customerUpload.create({
    data: {
      purpose: "RETURN_EVIDENCE",
      ownerUserId: userId,
      publicId: `${folder}/${randomUUID().slice(0, 12)}`,
      folder,
      status: "ISSUED",
      format: "jpg",
      bytes: 120_000,
      width: 1200,
      height: 900,
      verifiedAt: now,
      issuedAt: now,
    },
    select: { id: true, publicId: true },
  });
}
