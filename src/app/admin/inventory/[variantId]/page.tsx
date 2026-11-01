import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import styles from "@/components/admin/Admin.module.css";
import { AdminActionForm } from "@/components/admin/AdminActionForm";
import { AdminPageHeader } from "@/components/admin/AdminShell";
import { Field } from "@/components/forms/Field";
import { SelectField } from "@/components/forms/SelectField";
import { TextareaField } from "@/components/forms/TextareaField";
import {
  adjustInventoryAction,
  setThresholdAction,
} from "@/features/admin/inventory/actions";
import { variantIdSchema } from "@/features/admin/inventory/schemas";
import { getLevelDetail } from "@/features/admin/inventory/service";
import { requireStaffSession } from "@/server/auth/staff";
import { formatDateTime } from "@/lib/dates";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Stock" };

const NOTICES: Record<string, string> = {
  adjusted: "Stock adjusted and recorded.",
  threshold: "Low-stock threshold updated.",
};

export default async function InventoryVariantPage({
  params,
  searchParams,
}: PageProps<"/admin/inventory/[variantId]">) {
  const ctx = await requireStaffSession();
  const { variantId } = await params;
  const parsed = variantIdSchema.safeParse(variantId);
  if (!parsed.success) notFound();
  const detail = await getLevelDetail(ctx, parsed.data);
  if (!detail) notFound();
  const { level, history } = detail;
  const query = await searchParams;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;

  return (
    <div>
      <AdminPageHeader
        title={`${level.productTitle}${level.variantTitle ? ` · ${level.variantTitle}` : ""}`}
        lede={`SKU ${level.sku}. On hand ${level.stockOnHand}, held ${level.reserved}, available ${level.available}; low-stock threshold ${level.lowStockThreshold}.`}
      >
        <p>
          <Link href={routes.adminProduct(level.productId)}>
            Edit the product
          </Link>
        </p>
      </AdminPageHeader>
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}
      <div className={styles.grid}>
        <section className={styles.panel} aria-labelledby="stock-history">
          <h2 id="stock-history" className={styles.panelTitle}>
            Movements
          </h2>
          {history.length === 0 ? (
            <p className={styles.muted}>No adjustments recorded yet.</p>
          ) : (
            <ul className={styles.timeline}>
              {history.map((entry) => (
                <li key={entry.id} className={styles.timelineItem}>
                  <div>
                    <strong>{entry.kind.replaceAll("_", " ")}</strong>{" "}
                    {entry.delta > 0 ? `+${entry.delta}` : entry.delta} (
                    {entry.stockBefore} → {entry.stockAfter},{" "}
                    {entry.reservedAtTime} held)
                  </div>
                  <div>{entry.reason}</div>
                  <div className={styles.timelineMeta}>
                    {formatDateTime(entry.at)} · {entry.actor}
                    {entry.orderId && entry.orderNumber ? (
                      <>
                        {" · "}
                        <Link href={routes.adminOrder(entry.orderId)}>
                          {entry.orderNumber}
                        </Link>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className={styles.actions}>
          <section className={styles.panel} aria-labelledby="stock-adjust">
            <h2 id="stock-adjust" className={styles.panelTitle}>
              Adjust stock
            </h2>
            <AdminActionForm
              action={adjustInventoryAction}
              hidden={{ variantId: level.variantId }}
              submitLabel="Record adjustment"
            >
              <SelectField
                id="adjust-kind"
                name="kind"
                label="Kind"
                options={[
                  { value: "RECEIVED", label: "Received (adds units)" },
                  { value: "CORRECTION", label: "Correction (count differs)" },
                  { value: "WRITE_OFF", label: "Write-off (removes units)" },
                ]}
                required
              />
              <Field
                id="adjust-delta"
                name="delta"
                label="Change in units"
                hint="Signed: +5 adds five, -2 removes two. Stock can never go below the units held for pending orders."
                type="number"
                inputMode="numeric"
                step={1}
                required
              />
              <TextareaField
                id="adjust-reason"
                name="reason"
                label="Reason"
                required
                maxLength={500}
              />
            </AdminActionForm>
          </section>
          <section className={styles.panel} aria-labelledby="stock-threshold">
            <h2 id="stock-threshold" className={styles.panelTitle}>
              Low-stock threshold
            </h2>
            <AdminActionForm
              action={setThresholdAction}
              hidden={{ variantId: level.variantId }}
              submitLabel="Save threshold"
              variant="secondary"
            >
              <Field
                id="threshold"
                name="threshold"
                label="Warn when available is at or below"
                type="number"
                inputMode="numeric"
                min={0}
                defaultValue={level.lowStockThreshold}
                required
              />
            </AdminActionForm>
          </section>
        </div>
      </div>
    </div>
  );
}
