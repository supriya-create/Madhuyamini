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
import type { OrderNotice } from "@/features/admin/orders/actions";
import { orderIdSchema } from "@/features/admin/orders/schemas";
import { getOrderDetail } from "@/features/admin/orders/service";
import { requireStaffSession } from "@/server/auth/staff";
import { formatINR } from "@/lib/money";

export const metadata: Metadata = { title: "Order" };

const NOTICES: Record<OrderNotice, string> = {
  processing: "The order is marked as being prepared.",
  shipped: "Shipment recorded; the customer has been emailed.",
  delivered: "Marked as delivered; the customer has been emailed.",
  note: "Note added.",
  cancelled: "The order has been cancelled.",
  delivery_failed:
    "Delivery failure recorded. The parcel is returning to origin.",
  returned: "Parcel recorded as received. Inspect it to close the order.",
  inspected: "Inspection recorded, stock adjusted and the order closed.",
  carrier_lost: "Closed as lost in transit.",
  cod_collected: "Cash collection recorded.",
  cod_reversed: "Cash collection reversed.",
};

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
    typeof query.notice === "string" && query.notice in NOTICES
      ? NOTICES[query.notice as OrderNotice]
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
