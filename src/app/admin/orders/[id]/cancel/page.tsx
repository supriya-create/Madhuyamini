import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import styles from "@/components/admin/Admin.module.css";
import { AdminActionForm } from "@/components/admin/AdminActionForm";
import { AdminPageHeader } from "@/components/admin/AdminShell";
import { Field } from "@/components/forms/Field";
import { TextareaField } from "@/components/forms/TextareaField";
import { ButtonLink } from "@/components/ui/Button";
import { cancelOrderAction } from "@/features/admin/orders/actions";
import { orderIdSchema } from "@/features/admin/orders/schemas";
import { getOrderDetail } from "@/features/admin/orders/service";
import { requireStaffSession } from "@/server/auth/staff";
import { formatINR } from "@/lib/money";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Cancel order" };

/** Confirmation page: a reason and the typed order number (docs/admin.md §7). */
export default async function CancelOrderPage({
  params,
}: PageProps<"/admin/orders/[id]/cancel">) {
  const ctx = await requireStaffSession();
  const { id } = await params;
  const parsedId = orderIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const order = await getOrderDetail(ctx, parsedId.data);
  if (!order) notFound();
  if (!order.actions.cancel) redirect(routes.adminOrder(order.id));

  return (
    <div>
      <AdminPageHeader
        title={`Cancel order ${order.orderNumber}`}
        lede={
          order.actions.cancel === "pending"
            ? "This order is awaiting payment. Cancelling releases the held stock; nothing has been charged."
            : `This order is ${order.statusLabel.toLowerCase()}. Cancelling returns ${order.items.reduce((sum, item) => sum + item.quantity, 0)} unit(s) to stock and refunds any captured payment (${formatINR(order.totals.totalInPaise)}). This needs a fresh second factor.`
        }
      />
      <AdminActionForm
        action={cancelOrderAction}
        hidden={{ orderId: order.id }}
        submitLabel="Cancel this order"
        pendingLabel="Cancelling…"
        variant="secondary"
      >
        <TextareaField
          id="cancel-reason"
          name="reason"
          label="Reason"
          required
          maxLength={500}
        />
        <Field
          id="cancel-confirm"
          name="confirmOrderNumber"
          label={`Type ${order.orderNumber} to confirm`}
          autoComplete="off"
          autoCapitalize="characters"
          required
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
