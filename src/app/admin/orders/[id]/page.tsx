import type { Metadata } from "next";
import { notFound } from "next/navigation";

import styles from "@/components/admin/Admin.module.css";
import { AdminPageHeader } from "@/components/admin/AdminShell";
import { OrderActions } from "@/components/admin/orders/OrderActions";
import {
  OrderAddressPanel,
  OrderHistoryPanel,
  OrderItemsPanel,
  OrderPaymentsPanel,
  OrderShipmentPanel,
  OrderSummaryPanel,
} from "@/components/admin/orders/OrderDetailView";
import { StatusBadge } from "@/components/admin/orders/StatusBadge";
import { ORDER_NOTICES } from "@/features/admin/orders/action-support";
import type { OrderNotice } from "@/features/admin/orders/action-support";
import { orderIdSchema } from "@/features/admin/orders/schemas";
import { getOrderDetail } from "@/features/admin/orders/service";
import { requireStaffSession } from "@/server/auth/staff";
import { formatINR } from "@/lib/money";

export const metadata: Metadata = { title: "Order" };

export default async function AdminOrderPage({
  params,
  searchParams,
}: PageProps<"/admin/orders/[id]">) {
  const ctx = await requireStaffSession();
  const { id } = await params;
  const parsedId = orderIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const order = await getOrderDetail(ctx, parsedId.data);
  if (!order) notFound();
  const query = await searchParams;
  const notice =
    typeof query.notice === "string" && query.notice in ORDER_NOTICES
      ? ORDER_NOTICES[query.notice as OrderNotice]
      : null;

  return (
    <div>
      <AdminPageHeader title={`Order ${order.orderNumber}`}>
        <div className={styles.headerMeta}>
          <StatusBadge status={order.status} label={order.statusLabel} />
          <span>{formatINR(order.totals.totalInPaise)}</span>
          <span>
            {order.paymentMethod === "COD" ? "Cash on delivery" : "Paid online"}
          </span>
        </div>
      </AdminPageHeader>
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}
      <div className={styles.grid}>
        <div className={styles.actions}>
          <OrderItemsPanel order={order} />
          <OrderPaymentsPanel order={order} />
          <OrderShipmentPanel order={order} />
          <OrderHistoryPanel order={order} />
        </div>
        <div className={styles.actions}>
          <OrderActions order={order} />
          <OrderSummaryPanel order={order} />
          <OrderAddressPanel order={order} />
        </div>
      </div>
    </div>
  );
}
