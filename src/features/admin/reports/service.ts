import "server-only";

import type { StaffContext } from "@/server/auth/staff";

import { runAuditedExternal } from "../audit";
import {
  inventoryReport,
  operationsReport,
  productsReport,
  salesByPeriod,
  salesTotals,
} from "./data";
import { toCsv } from "./csv";
import type { ReportName, ReportWindow } from "./schemas";
import { toIsoDate } from "./schemas";

/** Report views and the audited CSV export (docs/admin.md §5.8). */

export async function getSalesReport(ctx: StaffContext, window: ReportWindow) {
  const [rows, totals] = await Promise.all([
    salesByPeriod(ctx, window),
    salesTotals(ctx, window),
  ]);
  return { rows, totals };
}

export async function getProductsReport(
  ctx: StaffContext,
  window: ReportWindow,
) {
  return productsReport(ctx, window);
}

export async function getInventoryReport(
  ctx: StaffContext,
  window: ReportWindow,
) {
  return inventoryReport(ctx, window);
}

export async function getOperationsReport(
  ctx: StaffContext,
  window: ReportWindow,
) {
  return operationsReport(ctx, window);
}

/** ADMIN with re-auth; the export itself is audited with its window. */
export async function exportReportCsv(
  ctx: StaffContext,
  report: ReportName,
  window: ReportWindow,
  now = new Date(),
): Promise<{ filename: string; body: string }> {
  return runAuditedExternal(
    {
      ctx,
      action: "report.export",
      targetType: "job",
      targetId: report,
      capability: "reports.export",
      reason: `${report} ${toIsoDate(window.from)}..${toIsoDate(window.to)} by ${window.granularity}`,
      now,
    },
    async () => {
      let rows: Array<Array<string | number | null>>;
      if (report === "sales") {
        const sales = await salesByPeriod(ctx, window);
        rows = [
          ["period", "method", "orders", "units", "gross_paise"],
          ...sales.map((r) => [
            r.bucket,
            r.method,
            r.orders,
            r.units,
            r.grossInPaise,
          ]),
        ];
      } else if (report === "products") {
        const products = await productsReport(ctx, window);
        rows = [
          ["product", "sku", "units", "revenue_paise"],
          ...products.map((r) => [
            r.productTitle,
            r.sku,
            r.units,
            r.revenueInPaise,
          ]),
        ];
      } else if (report === "inventory") {
        const inventory = await inventoryReport(ctx, window);
        rows = [
          ["metric", "value"],
          ["active_variants", inventory.variants],
          ["on_hand", inventory.onHand],
          ["reserved", inventory.reserved],
          ["value_paise", inventory.valueInPaise],
          ["low_stock", inventory.lowStock],
          ...inventory.adjustments.map((a) => [
            `adjustments_${a.kind.toLowerCase()}`,
            `${a.count} rows, ${a.units} units`,
          ]),
        ];
      } else {
        const operations = await operationsReport(ctx, window);
        rows = [
          ["metric", "value"],
          ...operations.attemptsByStatus.map((a) => [
            `attempts_${a.status.toLowerCase()}`,
            a.count,
          ]),
          ["success_rate_percent", operations.successRatePercent],
          ["average_minutes_to_capture", operations.averageMinutesToCapture],
          ["late_captures", operations.lateCaptures],
          ...operations.refundsByStatus.map((r) => [
            `refunds_${r.status.toLowerCase()}`,
            `${r.count} (${r.amountInPaise} paise)`,
          ]),
          ["failed_notifications", operations.failedNotifications],
          ["failed_webhooks", operations.failedWebhooks],
          ["delivery_failures", operations.deliveryFailures],
        ];
      }
      const filename = `madhuyamini-${report}-${toIsoDate(window.from)}-${toIsoDate(window.to)}.csv`;
      return {
        result: { filename, body: toCsv(rows) },
        after: { name: report, summary: `${rows.length - 1} rows` },
      };
    },
  );
}
