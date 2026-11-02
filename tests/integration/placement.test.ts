import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getCheckoutPolicy, minutesToMs } from "@/config/checkout-policy";
import type { Prisma } from "@/generated/prisma/client";
import {
  findActiveProductBySlug,
  findAvailableTechniques,
  findFeaturedProducts,
  findProductsPage,
  findRelatedProducts,
} from "@/features/catalog/data";
import { createOrderFromLines } from "@/features/orders/placement";
import { PlacementInputError } from "@/features/orders/placement-rules";
import type { PlacementInput } from "@/features/orders/placement";
import { isActiveProduct } from "@/features/wishlist/data";
import { db } from "@/server/db";

import {
  createCategory,
  createProduct,
  createUser,
  createVariant,
  resetDatabase,
  testDb,
} from "./db";

/**
 * Phase 8 step 8.0: the shared order-placement path and the foundation
 * columns (docs/phase-8-returns-custom-artwork.md §5.5, §7.1). Checkout's
 * own behaviour is pinned by checkout.test.ts; these tests drive
 * `createOrderFromLines` directly, as exchange settlement and commission
 * acceptance will.
 */

beforeEach(resetDatabase);
afterAll(() => testDb.$disconnect());

const address = {
  recipientName: "Asha Devi",
  line1: "12 Station Road",
  line2: null,
  landmark: null,
  city: "Madhubani",
  state: "Bihar",
  postalCode: "847211",
  country: "IN",
};

const noLinks = {
  exchangeOfOrderId: null,
  commissionRequestId: null,
  instalment: null,
};

async function stockedVariant(sku: string, stock = 5) {
  const category = await createCategory(`cat-${sku}`);
  const product = await createProduct(category.id, `product-${sku}`);
  const variant = await createVariant(product.id, sku, 129_900);
  await testDb.inventory.update({
    where: { variantId: variant.id },
    data: { stockOnHand: stock },
  });
  return { category, product, variant };
}

function lineFor(variantId: string, sku: string, quantity: number) {
  return {
    variantId,
    productSlug: `product-${sku}`,
    productTitle: `Product ${sku}`,
    variantTitle: null,
    sku,
    quantity,
    unitPriceInPaise: 129_900,
    taxRateBp: null,
    hsnCode: null,
    imageUrl: null,
    imageAlt: null,
  };
}

function amountsFor(subtotal: number, discount = 0) {
  return {
    subtotalInPaise: subtotal,
    shippingInPaise: 0,
    codFeeInPaise: 0,
    discountInPaise: discount,
    totalInPaise: subtotal - discount,
  };
}

async function place(input: PlacementInput) {
  return db.$transaction((tx) => createOrderFromLines(tx, input));
}

async function baseInput(sku: string, quantity = 2): Promise<PlacementInput> {
  const { variant } = await stockedVariant(sku);
  const user = await createUser(`${sku.toLowerCase()}@example.com`);
  return {
    kind: "STANDARD",
    links: noLinks,
    paymentMethod: "COD",
    lines: [lineFor(variant.id, sku, quantity)],
    amounts: amountsFor(129_900 * quantity),
    stock: "manage",
    customer: {
      userId: user.id,
      email: `${sku.toLowerCase()}@example.com`,
      phone: "+919876543210",
    },
    address,
    customerNote: null,
    cartId: null,
    now: new Date(),
  };
}

const stockOf = (variantId: string) =>
  testDb.inventory.findUniqueOrThrow({
    where: { variantId },
    select: { stockOnHand: true, reserved: true },
  });

describe("createOrderFromLines", () => {
  it("places a cash-on-delivery order: stock committed, COD attempt, event and e-mails", async () => {
    const input = await baseInput("PL-COD");
    const placed = await place(input);
    expect(placed.status).toBe("CONFIRMED");
    expect(placed.attemptId).toBeNull();
    expect(placed.pendingExpiresAt).toBeNull();
    const order = await testDb.order.findUniqueOrThrow({
      where: { id: placed.orderId },
      include: {
        items: true,
        payments: true,
        events: true,
        notifications: true,
      },
    });
    expect(order).toMatchObject({
      kind: "STANDARD",
      status: "CONFIRMED",
      paymentMethod: "COD",
      totalInPaise: 259_800,
      cartId: null,
      exchangeOfOrderId: null,
      commissionRequestId: null,
      instalment: null,
    });
    expect(order.confirmedAt).toEqual(input.now);
    expect(
      order.items.map((i) => [i.sku, i.quantity, i.lineTotalInPaise]),
    ).toEqual([["PL-COD", 2, 259_800]]);
    expect(
      order.payments.map((p) => [
        p.method,
        p.status,
        p.amountInPaise,
        p.receipt,
      ]),
    ).toEqual([["COD", "CREATED", 259_800, `${placed.orderNumber}-1`]]);
    expect(order.events.map((e) => [e.type, e.toStatus, e.note])).toEqual([
      ["order.placed", "CONFIRMED", "Cash on delivery; stock committed."],
    ]);
    expect(order.notifications.map((n) => n.kind)).toContain("order.confirmed");
    const variantId = input.lines[0]?.variantId ?? "";
    expect(await stockOf(variantId)).toEqual({ stockOnHand: 3, reserved: 0 });
  });

  it("places an online order: stock held until the deadline, first attempt initiated", async () => {
    const input = {
      ...(await baseInput("PL-ONL")),
      paymentMethod: "RAZORPAY" as const,
    };
    const placed = await place(input);
    expect(placed.status).toBe("PENDING_PAYMENT");
    expect(placed.attemptId).not.toBeNull();
    const ttl = minutesToMs(getCheckoutPolicy().reservation.ttlMinutes);
    expect(placed.pendingExpiresAt).toEqual(
      new Date(input.now.getTime() + ttl),
    );
    const order = await testDb.order.findUniqueOrThrow({
      where: { id: placed.orderId },
      include: {
        payments: true,
        reservations: true,
        events: true,
        notifications: true,
      },
    });
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.payments.map((p) => [p.method, p.status])).toEqual([
      ["RAZORPAY", "INITIATED"],
    ]);
    expect(order.reservations.map((r) => [r.status, r.quantity])).toEqual([
      ["ACTIVE", 2],
    ]);
    expect(order.events.map((e) => e.note)).toEqual([
      "Stock held until the payment deadline.",
    ]);
    expect(order.notifications).toHaveLength(0);
    const variantId = input.lines[0]?.variantId ?? "";
    expect(await stockOf(variantId)).toEqual({ stockOnHand: 5, reserved: 2 });
  });

  it("settles a zero-total replacement by store credit: confirmed, stock committed, no attempt", async () => {
    const original = await place(await baseInput("PL-ORIG"));
    const { variant } = await stockedVariant("PL-REPL");
    const input: PlacementInput = {
      ...(await baseInput("PL-REPL-CUST", 1)),
      kind: "EXCHANGE_REPLACEMENT",
      links: { ...noLinks, exchangeOfOrderId: original.orderId },
      paymentMethod: "STORE_CREDIT",
      lines: [lineFor(variant.id, "PL-REPL", 1)],
      amounts: amountsFor(129_900, 129_900),
    };
    const placed = await place(input);
    expect(placed.status).toBe("CONFIRMED");
    expect(placed.attemptId).toBeNull();
    const order = await testDb.order.findUniqueOrThrow({
      where: { id: placed.orderId },
      include: {
        payments: true,
        events: true,
        notifications: true,
        exchangeOf: true,
      },
    });
    expect(order).toMatchObject({
      kind: "EXCHANGE_REPLACEMENT",
      paymentMethod: "STORE_CREDIT",
      discountInPaise: 129_900,
      totalInPaise: 0,
      exchangeOfOrderId: original.orderId,
    });
    expect(order.exchangeOf?.orderNumber).toBe(original.orderNumber);
    expect(order.payments).toHaveLength(0);
    expect(order.events.map((e) => e.note)).toEqual([
      "Settled by store credit; stock committed.",
    ]);
    expect(order.notifications.map((n) => n.kind)).toContain("order.confirmed");
    expect(await stockOf(variant.id)).toEqual({ stockOnHand: 4, reserved: 0 });
    // The original cannot be deleted while a replacement points at it.
    await expect(
      testDb.order.delete({ where: { id: original.orderId } }),
    ).rejects.toThrow();
  });

  it("places commission instalments without touching stock, one deposit and one balance per commission", async () => {
    const commissionRequestId = randomUUID();
    const base = await baseInput("PL-CMN", 1);
    const variantId = base.lines[0]?.variantId ?? "";
    const deposit = await place({
      ...base,
      kind: "COMMISSION_INSTALMENT",
      links: { ...noLinks, commissionRequestId, instalment: "DEPOSIT" },
      paymentMethod: "RAZORPAY",
      stock: "none",
    });
    expect(deposit.status).toBe("PENDING_PAYMENT");
    expect(await stockOf(variantId)).toEqual({ stockOnHand: 5, reserved: 0 });
    expect(
      await testDb.inventoryReservation.count({
        where: { orderId: deposit.orderId },
      }),
    ).toBe(0);
    const row = await testDb.order.findUniqueOrThrow({
      where: { id: deposit.orderId },
      include: { events: true, payments: true },
    });
    expect(row).toMatchObject({
      kind: "COMMISSION_INSTALMENT",
      commissionRequestId,
      instalment: "DEPOSIT",
    });
    expect(row.events.map((e) => e.note)).toEqual(["Awaiting payment."]);
    expect(row.payments.map((p) => p.status)).toEqual(["INITIATED"]);

    await expect(
      place({
        ...base,
        kind: "COMMISSION_INSTALMENT",
        links: { ...noLinks, commissionRequestId, instalment: "DEPOSIT" },
        paymentMethod: "RAZORPAY",
        stock: "none",
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    const balance = await place({
      ...base,
      kind: "COMMISSION_INSTALMENT",
      links: { ...noLinks, commissionRequestId, instalment: "BALANCE" },
      paymentMethod: "RAZORPAY",
      stock: "none",
    });
    expect(balance.status).toBe("PENDING_PAYMENT");
  });

  it("refuses inconsistent input before writing anything", async () => {
    const base = await baseInput("PL-BAD");
    await expect(place({ ...base, stock: "none" })).rejects.toBeInstanceOf(
      PlacementInputError,
    );
    await expect(
      place({ ...base, paymentMethod: "STORE_CREDIT" }),
    ).rejects.toBeInstanceOf(PlacementInputError);
    await expect(
      place({
        ...base,
        amounts: {
          ...base.amounts,
          totalInPaise: base.amounts.totalInPaise + 1,
        },
      }),
    ).rejects.toBeInstanceOf(PlacementInputError);
    expect(await testDb.order.count()).toBe(0);
  });
});

describe("foundation constraints (migration 20261102180000)", () => {
  const orderData = (
    overrides: Partial<Prisma.OrderUncheckedCreateInput> = {},
  ): Prisma.OrderUncheckedCreateInput => ({
    orderNumber: `MY-${randomUUID().slice(0, 8).toUpperCase()}`,
    email: "asha@example.com",
    phone: "+919876543210",
    status: "CONFIRMED",
    paymentMethod: "COD",
    subtotalInPaise: 100,
    shippingInPaise: 0,
    codFeeInPaise: 0,
    discountInPaise: 0,
    totalInPaise: 100,
    recipientName: "Asha Devi",
    addressLine1: "12 Station Road",
    city: "Madhubani",
    state: "Bihar",
    postalCode: "847211",
    confirmedAt: new Date(),
    ...overrides,
  });
  const insert = (overrides?: Partial<Prisma.OrderUncheckedCreateInput>) =>
    testDb.order.create({ data: orderData(overrides), select: { id: true } });

  it("store credit never carries an amount", async () => {
    await expect(insert({ paymentMethod: "STORE_CREDIT" })).rejects.toThrow(
      /orders_store_credit_is_free/,
    );
    await expect(
      insert({
        paymentMethod: "STORE_CREDIT",
        discountInPaise: 100,
        totalInPaise: 0,
      }),
    ).resolves.toBeTruthy();
  });

  it("replacement and instalment orders carry exactly their parent links", async () => {
    await expect(insert({ kind: "EXCHANGE_REPLACEMENT" })).rejects.toThrow(
      /orders_replacement_has_parent/,
    );
    await expect(insert({ kind: "COMMISSION_INSTALMENT" })).rejects.toThrow(
      /orders_instalment_has_commission/,
    );
    await expect(
      insert({
        kind: "COMMISSION_INSTALMENT",
        commissionRequestId: randomUUID(),
      }),
    ).rejects.toThrow(/orders_instalment_has_commission/);
    const parent = await insert();
    await expect(insert({ exchangeOfOrderId: parent.id })).rejects.toThrow(
      /orders_parent_links_match_kind/,
    );
    await expect(insert({ instalment: "DEPOSIT" })).rejects.toThrow(
      /orders_parent_links_match_kind/,
    );
    await expect(
      insert({ kind: "EXCHANGE_REPLACEMENT", exchangeOfOrderId: parent.id }),
    ).resolves.toBeTruthy();
  });

  it("defaults existing rows to standard catalogue meaning", async () => {
    const order = await insert();
    const row = await testDb.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(row.kind).toBe("STANDARD");
    const category = await createCategory();
    const product = await createProduct(category.id);
    expect(
      (await testDb.product.findUniqueOrThrow({ where: { id: product.id } }))
        .kind,
    ).toBe("CATALOGUE");
  });
});

describe("commission products never reach the storefront", () => {
  it("is excluded from every storefront read even when active and featured", async () => {
    const category = await createCategory("cat-store");
    const catalogue = await createProduct(category.id, "catalogue-piece");
    await createVariant(catalogue.id, "CAT-1");
    const commission = await createProduct(category.id, "commission-piece");
    await createVariant(commission.id, "CMN-1");
    await testDb.product.update({
      where: { id: commission.id },
      data: {
        kind: "COMMISSION",
        isFeatured: true,
        techniques: ["HAND_BLOCK_PRINTED"],
      },
    });

    expect(await findActiveProductBySlug("commission-piece")).toBeNull();
    expect(await findActiveProductBySlug("catalogue-piece")).not.toBeNull();
    expect((await findFeaturedProducts(10)).map((p) => p.id)).not.toContain(
      commission.id,
    );
    const page = await findProductsPage({
      techniques: [],
      inStock: false,
      sort: "newest",
      skip: 0,
      take: 10,
    });
    expect(page.items.map((p) => p.id)).toEqual([catalogue.id]);
    const search = await findProductsPage({
      q: "commission",
      techniques: [],
      inStock: false,
      sort: "newest",
      skip: 0,
      take: 10,
    });
    expect(search.items).toHaveLength(0);
    expect(await findAvailableTechniques()).toEqual(["HAND_PAINTED"]);
    expect(
      (
        await findRelatedProducts({
          productId: catalogue.id,
          categoryIds: [category.id],
          take: 10,
        })
      ).map((p) => p.id),
    ).not.toContain(commission.id);
    expect(await isActiveProduct(commission.id)).toBeNull();
    expect(await isActiveProduct(catalogue.id)).not.toBeNull();
  });
});
