import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import styles from "@/components/admin/Admin.module.css";
import { AdminActionForm } from "@/components/admin/AdminActionForm";
import { AdminPageHeader } from "@/components/admin/AdminShell";
import { Field } from "@/components/forms/Field";
import { TextareaField } from "@/components/forms/TextareaField";
import { ButtonLink } from "@/components/ui/Button";
import { completeInspectionAction } from "@/features/admin/orders/actions";
import { orderIdSchema } from "@/features/admin/orders/schemas";
import { getOrderDetail } from "@/features/admin/orders/service";
import { requireStaffSession } from "@/server/auth/staff";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Inspect returned parcel" };

/** Per-line restock / write-off for a returned parcel (docs/admin.md §5.11). */
export default async function InspectionPage({
  params,
}: PageProps<"/admin/orders/[id]/inspection">) {
  const ctx = await requireStaffSession();
  const { id } = await params;
  const parsedId = orderIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const order = await getOrderDetail(ctx, parsedId.data);
  if (!order) notFound();
  if (!order.actions.inspection) redirect(routes.adminOrder(order.id));

  return (
    <div>
      <AdminPageHeader
        title={`Inspect the returned parcel for ${order.orderNumber}`}
        lede="For each line, say how many units go back on the shelf and how many are written off. The two must add up to the quantity ordered. Restocked units become available immediately; the order closes as cancelled and any captured payment is refunded."
      />
      <AdminActionForm
        action={completeInspectionAction}
        hidden={{ orderId: order.id }}
        submitLabel="Record inspection and close the order"
        pendingLabel="Recording…"
        wide
      >
        {order.items.map((item) => (
          <div key={item.id} className={styles.lineGrid}>
            <div className={styles.lineHead} style={{ gridColumn: "1 / -1" }}>
              <strong>{item.productTitle}</strong>
              <span className={styles.muted}>
                {item.sku} · {item.quantity} ordered
              </span>
            </div>
            <Field
              id={`restock-${item.id}`}
              name={`restock:${item.id}`}
              label="Back to stock"
              type="number"
              inputMode="numeric"
              min={0}
              max={item.quantity}
              defaultValue={item.quantity}
              required
            />
            <Field
              id={`writeoff-${item.id}`}
              name={`writeoff:${item.id}`}
              label="Written off"
              type="number"
              inputMode="numeric"
              min={0}
              max={item.quantity}
              defaultValue={0}
              required
            />
          </div>
        ))}
        <TextareaField
          id="inspection-note"
          name="note"
          label="Inspection note"
          hint="Condition of the goods and why anything was written off."
          required
          maxLength={500}
        />
      </AdminActionForm>
      <p className={styles.muted}>
        <ButtonLink href={routes.adminOrder(order.id)} variant="quiet">
          Back to the order
        </ButtonLink>
      </p>
    </div>
  );
}
