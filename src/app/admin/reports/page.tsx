import type { Metadata } from "next";
import Link from "next/link";

import styles from "@/components/admin/Admin.module.css";
import { TableWrap } from "@/components/admin/TableWrap";
import { AdminPageHeader } from "@/components/admin/AdminShell";
import { Field } from "@/components/forms/Field";
import { SelectField } from "@/components/forms/SelectField";
import { Button, ButtonLink } from "@/components/ui/Button";
import { can } from "@/features/admin/authz";
import {
  GRANULARITIES,
  REPORTS,
  reportQuerySchema,
  resolveWindow,
  toIsoDate,
} from "@/features/admin/reports/schemas";
import {
  getInventoryReport,
  getOperationsReport,
  getProductsReport,
  getSalesReport,
} from "@/features/admin/reports/service";
import { requireStaffSession } from "@/server/auth/staff";
import { formatINR } from "@/lib/money";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Reports" };

const LABELS: Record<(typeof REPORTS)[number], string> = {
  sales: "Sales",
  products: "Products",
  inventory: "Inventory",
  operations: "Operations",
};

export default async function ReportsPage({
  searchParams,
}: PageProps<"/admin/reports">) {
  const ctx = await requireStaffSession();
  const raw = await searchParams;
  const query = reportQuerySchema.parse({
    report: typeof raw.report === "string" ? raw.report : undefined,
    from: typeof raw.from === "string" ? raw.from : undefined,
    to: typeof raw.to === "string" ? raw.to : undefined,
    granularity:
      typeof raw.granularity === "string" ? raw.granularity : undefined,
  });
  const report = query.report ?? "sales";
  const window = resolveWindow(query);
  const windowParams = new URLSearchParams({
    from: toIsoDate(window.from),
    to: toIsoDate(new Date(window.to.getTime() - 1)),
    granularity: window.granularity,
  });
  const exportHref = `${routes.adminReportsExport}?report=${report}&${windowParams.toString()}`;

  return (
    <div>
      <AdminPageHeader
        title="Reports"
        lede="Revenue counts orders that are confirmed or beyond with a captured or collected payment, less processed refunds. Times are Indian Standard Time."
      />
      <nav aria-label="Reports" className={styles.inline}>
        {REPORTS.map((name) => (
          <Link
            key={name}
            href={`${routes.adminReports}?report=${name}&${windowParams.toString()}`}
            aria-current={report === name ? "page" : undefined}
          >
            {LABELS[name]}
          </Link>
        ))}
      </nav>
      <form
        method="get"
        action={routes.adminReports}
        className={styles.filters}
      >
        <input type="hidden" name="report" value={report} />
        <div className={styles.filterRow}>
          <Field
            id="rp-from"
            name="from"
            label="From"
            type="date"
            defaultValue={toIsoDate(window.from)}
          />
          <Field
            id="rp-to"
            name="to"
            label="To"
            type="date"
            defaultValue={toIsoDate(new Date(window.to.getTime() - 1))}
          />
          <SelectField
            id="rp-granularity"
            name="granularity"
            label="Group by"
            defaultValue={window.granularity}
            options={GRANULARITIES.map((g) => ({ value: g, label: g }))}
          />
        </div>
        <div className={styles.filterActions}>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {can(ctx.role, "reports.export") ? (
            <ButtonLink href={exportHref} variant="quiet">
              Download CSV
            </ButtonLink>
          ) : null}
        </div>
      </form>
      <h2 className={styles.sectionTitleSpaced}>{LABELS[report]}</h2>
      {report === "sales" ? (
        <SalesView
          window={window}
          ctxRole={ctx.role}
          data={await getSalesReport(ctx, window)}
        />
      ) : null}
      {report === "products" ? (
        <ProductsView data={await getProductsReport(ctx, window)} />
      ) : null}
      {report === "inventory" ? (
        <InventoryView data={await getInventoryReport(ctx, window)} />
      ) : null}
      {report === "operations" ? (
        <OperationsView data={await getOperationsReport(ctx, window)} />
      ) : null}
    </div>
  );
}

function SalesView({
  data,
}: {
  window: ReturnType<typeof resolveWindow>;
  ctxRole: string;
  data: Awaited<ReturnType<typeof getSalesReport>>;
}) {
  const { totals, rows } = data;
  return (
    <div className={styles.actions}>
      <ul className={styles.stats}>
        <li className={styles.stat}>
          <span className={styles.statValue}>
            {formatINR(totals.grossInPaise)}
          </span>
          <span className={styles.statLabel}>Gross revenue</span>
          <span className={styles.statHint}>
            {totals.orders} paid orders · {totals.units} units
          </span>
        </li>
        <li className={styles.stat}>
          <span className={styles.statValue}>
            {formatINR(totals.refundedInPaise)}
          </span>
          <span className={styles.statLabel}>Refunded</span>
          <span className={styles.statHint}>processed in the period</span>
        </li>
        <li className={styles.stat}>
          <span className={styles.statValue}>
            {formatINR(totals.grossInPaise - totals.refundedInPaise)}
          </span>
          <span className={styles.statLabel}>Net</span>
          <span className={styles.statHint}>
            average order {formatINR(totals.averageOrderInPaise)}
          </span>
        </li>
        <li className={styles.stat}>
          <span className={styles.statValue}>{totals.cancelledOrders}</span>
          <span className={styles.statLabel}>Cancelled</span>
          <span className={styles.statHint}>
            {formatINR(totals.cancelledInPaise)} not realised
          </span>
        </li>
      </ul>
      {rows.length === 0 ? (
        <p className={styles.empty}>No paid orders in this period.</p>
      ) : (
        <TableWrap label="Report rows">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">Method</th>
                <th scope="col" className={styles.num}>
                  Orders
                </th>
                <th scope="col" className={styles.num}>
                  Units
                </th>
                <th scope="col" className={styles.num}>
                  Gross
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.bucket}-${row.method}`}>
                  <td>{row.bucket}</td>
                  <td>
                    {row.method === "COD" ? "Cash on delivery" : "Online"}
                  </td>
                  <td className={styles.num}>{row.orders}</td>
                  <td className={styles.num}>{row.units}</td>
                  <td className={styles.num}>{formatINR(row.grossInPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}

function ProductsView({
  data,
}: {
  data: Awaited<ReturnType<typeof getProductsReport>>;
}) {
  if (data.length === 0)
    return <p className={styles.empty}>No units sold in this period.</p>;
  return (
    <TableWrap label="Report rows">
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col">SKU</th>
            <th scope="col" className={styles.num}>
              Units
            </th>
            <th scope="col" className={styles.num}>
              Revenue
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.sku}>
              <td>{row.productTitle}</td>
              <td className={styles.mono}>{row.sku}</td>
              <td className={styles.num}>{row.units}</td>
              <td className={styles.num}>{formatINR(row.revenueInPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function InventoryView({
  data,
}: {
  data: Awaited<ReturnType<typeof getInventoryReport>>;
}) {
  return (
    <div className={styles.actions}>
      <ul className={styles.stats}>
        <li className={styles.stat}>
          <span className={styles.statValue}>
            {data.onHand - data.reserved}
          </span>
          <span className={styles.statLabel}>Units available</span>
          <span className={styles.statHint}>
            {data.onHand} on hand · {data.reserved} held · {data.variants} live
            variants
          </span>
        </li>
        <li className={styles.stat}>
          <span className={styles.statValue}>
            {formatINR(data.valueInPaise)}
          </span>
          <span className={styles.statLabel}>Value at current prices</span>
          <span className={styles.statHint}>available units × price</span>
        </li>
        <li
          className={styles.stat}
          data-attention={data.lowStock > 0 ? "true" : undefined}
        >
          <span className={styles.statValue}>{data.lowStock}</span>
          <span className={styles.statLabel}>Low stock</span>
          <span className={styles.statHint}>at or below threshold</span>
        </li>
      </ul>
      <h3 className={styles.panelTitle}>Adjustments in the period</h3>
      {data.adjustments.length === 0 ? (
        <p className={styles.muted}>None.</p>
      ) : (
        <dl className={styles.dl}>
          {data.adjustments.map((a) => (
            <div key={a.kind} style={{ display: "contents" }}>
              <dt>{a.kind.replaceAll("_", " ").toLowerCase()}</dt>
              <dd>
                {a.count} movement{a.count === 1 ? "" : "s"},{" "}
                {a.units > 0 ? `+${a.units}` : a.units} units
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function OperationsView({
  data,
}: {
  data: Awaited<ReturnType<typeof getOperationsReport>>;
}) {
  return (
    <div className={styles.actions}>
      <ul className={styles.stats}>
        <li className={styles.stat}>
          <span className={styles.statValue}>
            {data.successRatePercent === null
              ? "—"
              : `${data.successRatePercent}%`}
          </span>
          <span className={styles.statLabel}>Online payment success</span>
          <span className={styles.statHint}>
            captured ÷ attempts that reached the provider
          </span>
        </li>
        <li className={styles.stat}>
          <span className={styles.statValue}>
            {data.averageMinutesToCapture === null
              ? "—"
              : `${data.averageMinutesToCapture} min`}
          </span>
          <span className={styles.statLabel}>Placement to capture</span>
          <span className={styles.statHint}>average</span>
        </li>
        <li className={styles.stat}>
          <span className={styles.statValue}>{data.lateCaptures}</span>
          <span className={styles.statLabel}>Late captures</span>
          <span className={styles.statHint}>paid after the deadline</span>
        </li>
        <li
          className={styles.stat}
          data-attention={
            data.failedNotifications + data.failedWebhooks > 0
              ? "true"
              : undefined
          }
        >
          <span className={styles.statValue}>
            {data.failedNotifications + data.failedWebhooks}
          </span>
          <span className={styles.statLabel}>Failed jobs</span>
          <span className={styles.statHint}>
            {data.failedNotifications} emails · {data.failedWebhooks} webhooks ·{" "}
            {data.deliveryFailures} delivery failures
          </span>
        </li>
      </ul>
      <dl className={styles.dl}>
        {data.attemptsByStatus.map((a) => (
          <div key={a.status} style={{ display: "contents" }}>
            <dt>attempts {a.status.toLowerCase()}</dt>
            <dd>{a.count}</dd>
          </div>
        ))}
        {data.refundsByStatus.map((r) => (
          <div key={r.status} style={{ display: "contents" }}>
            <dt>refunds {r.status.toLowerCase()}</dt>
            <dd>
              {r.count} · {formatINR(r.amountInPaise)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
