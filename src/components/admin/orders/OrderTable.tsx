import Link from "next/link";

import styles from "@/components/admin/Admin.module.css";
import type { AdminOrderListItem } from "@/features/admin/orders/types";
import { formatDateTime } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { routes } from "@/lib/routes";

import { StatusBadge } from "./StatusBadge";

export function OrderTable({
  items,
}: {
  items: ReadonlyArray<AdminOrderListItem>;
}) {
  if (items.length === 0) {
    return <p className={styles.empty}>No orders match these filters.</p>;
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Order</th>
            <th scope="col">Placed</th>
            <th scope="col">Status</th>
            <th scope="col">Payment</th>
            <th scope="col">Customer</th>
            <th scope="col" className={styles.num}>
              Units
            </th>
            <th scope="col" className={styles.num}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((order) => (
            <tr key={order.id}>
              <td>
                <Link
                  href={routes.adminOrder(order.id)}
                  className={styles.rowLink}
                >
                  {order.orderNumber}
                </Link>
                {order.carrier ? (
                  <div className={styles.muted}>{order.carrier}</div>
                ) : null}
              </td>
              <td>{formatDateTime(order.placedAt)}</td>
              <td>
                <StatusBadge status={order.status} label={order.statusLabel} />
              </td>
              <td>
                {order.paymentMethod === "COD" ? "Cash on delivery" : "Online"}
                {order.latestPaymentStatus ? (
                  <div className={styles.muted}>
                    {order.latestPaymentStatus.toLowerCase()}
                  </div>
                ) : null}
              </td>
              <td>
                {order.recipientName}
                <div className={styles.muted}>
                  {order.emailMasked} · {order.city}
                </div>
              </td>
              <td className={styles.num}>{order.units}</td>
              <td className={styles.num}>{formatINR(order.totalInPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
