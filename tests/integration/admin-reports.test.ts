import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenCapabilityError } from "@/features/admin/authz";
import {
  cancelOrder,
  collectCod,
  markDelivered,
  shipOrder,
  startProcessing,
} from "@/features/admin/orders/service";
import { createRefund } from "@/features/admin/payments/service";
import { toCsv } from "@/features/admin/reports/csv";
import { resolveWindow } from "@/features/admin/reports/schemas";
import {
  exportReportCsv,
  getInventoryReport,
  getOperationsReport,
  getProductsReport,
  getSalesReport,
} from "@/features/admin/reports/service";
import { db } from "@/server/db";
import { runRefundPayments } from "@/server/jobs/refund-payments";
import { getFakeGateway } from "@/server/payments";

import { resetDatabase, testDb } from "./db";
import { confirmedOnlineOrder, placeTestOrder } from "./order-fixtures";
import { verifiedStaff } from "./staff";

/** Reports (docs/admin.md §5.8): the revenue definition, per-period rows and the audited CSV export. */

const gateway = getFakeGateway();

beforeEach(async () => {
  await resetDatabase();
  gateway.reset();
});
afterAll(async () => {
  await testDb.$disconnect();
  await db.$disconnect();
});

const SHIP = { carrier: "India Post", trackingNumber: null, trackingUrl: null };

describe("sales and products", () => {
  it("counts paid online orders and collected COD only, nets processed refunds, and lists cancellations", async () => {
    const staff = await verifiedStaff("STAFF");
    const admin = await verifiedStaff("ADMIN");
    const paid = await confirmedOnlineOrder({
      sku: "RPT-1",
      quantity: 2,
      price: 100_000,
    });
    const pending = await placeTestOrder("RAZORPAY", {
      sku: "RPT-2",
      email: "p@example.com",
    });
    const cod = await placeTestOrder("COD", {
      sku: "RPT-3",
      email: "c@example.com",
      price: 50_000,
    });
    const window = resolveWindow({});

    let sales = await getSalesReport(staff.ctx, window);
    // Pending online and uncollected COD are not revenue yet.
    expect(sales.totals).toMatchObject({
      orders: 1,
      units: 2,
      grossInPaise: paid.totalInPaise,
    });
    expect(sales.rows).toEqual([
      expect.objectContaining({
        method: "RAZORPAY",
        orders: 1,
        units: 2,
        grossInPaise: paid.totalInPaise,
      }),
    ]);

    await startProcessing(staff.ctx, cod.orderId);
    await shipOrder(staff.ctx, cod.orderId, SHIP);
    await markDelivered(staff.ctx, cod.orderId);
    await collectCod(staff.ctx, cod.orderId, {
      amountInPaise: cod.totalInPaise,
      reason: null,
    });
    sales = await getSalesReport(staff.ctx, window);
    expect(sales.totals.orders).toBe(2);
    expect(sales.rows.map((r) => r.method).sort()).toEqual(["COD", "RAZORPAY"]);

    await createRefund(admin.ctx, paid.orderId, {
      amountInPaise: 10_000,
      reason: "Goodwill.",
    });
    await runRefundPayments();
    await cancelOrder(staff.ctx, pending.orderId, {
      reason: "Dup.",
      confirmOrderNumber: pending.orderNumber,
    });
    sales = await getSalesReport(staff.ctx, window);
    expect(sales.totals).toMatchObject({
      refundedInPaise: 10_000,
      cancelledOrders: 1,
      cancelledInPaise: pending.totalInPaise,
    });

    const products = await getProductsReport(staff.ctx, window);
    expect(products.map((p) => [p.sku, p.units])).toEqual(
      expect.arrayContaining([
        ["RPT-1", 2],
        ["RPT-3", 1],
      ]),
    );
    expect(products.find((p) => p.sku === "RPT-2")).toBeUndefined();

    const inventory = await getInventoryReport(staff.ctx, window);
    expect(inventory.variants).toBe(3);
    expect(inventory.adjustments).toEqual([]);

    const operations = await getOperationsReport(staff.ctx, window);
    expect(operations.attemptsByStatus.map((a) => a.status).sort()).toEqual([
      "CAPTURED",
      "CREATED",
    ]);
    expect(operations.successRatePercent).toBe(50);
    expect(operations.refundsByStatus).toEqual([
      { status: "PROCESSED", count: 1, amountInPaise: 10_000 },
    ]);
  });
});

describe("CSV export", () => {
  it("is ADMIN-only, audited with its window, and neutralises spreadsheet formulas", async () => {
    const staff = await verifiedStaff("STAFF");
    const admin = await verifiedStaff("ADMIN");
    await confirmedOnlineOrder({ sku: "CSV-1" });
    const window = resolveWindow({});
    await expect(
      exportReportCsv(staff.ctx, "sales", window),
    ).rejects.toBeInstanceOf(ForbiddenCapabilityError);
    const { filename, body } = await exportReportCsv(
      admin.ctx,
      "sales",
      window,
    );
    expect(filename).toMatch(
      /^madhuyamini-sales-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    const [header, first] = body.split("\r\n");
    expect(header).toBe("period,method,orders,units,gross_paise");
    expect(first).toMatch(/^\d{4}-\d{2}-\d{2},RAZORPAY,1,1,\d+$/);
    const audits = await testDb.adminAuditLog.findMany({
      where: { action: "report.export" },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((a) => a.outcome)).toEqual(["REFUSED", "SUCCESS"]);
    expect(audits[1]?.reason).toMatch(
      /^sales \d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2} by day$/,
    );

    expect(toCsv([["=SUM(A1)", 'say "hi"', null, 5]])).toBe(
      `'=SUM(A1),"say ""hi""",,5\r\n`,
    );
  });
});
