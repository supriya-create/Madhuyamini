import Link from "next/link";

import type { OrderSummaryView } from "@/features/orders/types";
import { formatDate } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { routes } from "@/lib/routes";

import styles from "./OrderList.module.css";

export function OrderList({ orders }: { orders: readonly OrderSummaryView[] }) {
  return (
    <ul className={styles.list}>
      {orders.map((order) => (
        <li key={order.id} className={styles.item}>
          <div className={styles.summary}>
            <p className={styles.number}>
              <Link href={routes.accountOrder(order.orderNumber)}>
                {order.orderNumber}
              </Link>
            </p>
            <p className={styles.meta}>
              {formatDate(order.placedAt)} · {order.itemCount}{" "}
              {order.itemCount === 1 ? "item" : "items"}
              {order.firstItem
                ? ` · ${order.firstItem.title}${order.itemCount > 1 ? " and more" : ""}`
                : ""}
            </p>
          </div>
          <p className={styles.total}>{formatINR(order.totalInPaise)}</p>
          <p className={styles.status} data-status={order.status}>
            {order.statusLabel}
          </p>
          {order.awaitingPayment ? (
            <Link href={routes.checkoutPay(order.id)} className={styles.pay}>
              Pay now
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
