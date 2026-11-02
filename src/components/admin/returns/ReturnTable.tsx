import Link from "next/link";

import styles from "@/components/admin/Admin.module.css";
import { Badge } from "@/components/admin/orders/StatusBadge";
import { TableWrap } from "@/components/admin/TableWrap";
import type { AdminReturnListItem } from "@/features/admin/returns/types";
import type { ReturnStatus } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/dates";
import { routes } from "@/lib/routes";

export const RETURN_TONES: Partial<
  Record<ReturnStatus, "good" | "warn" | "bad">
> = {
  APPROVED: "good",
  IN_TRANSIT: "good",
  RECEIVED: "good",
  INSPECTED: "good",
  CLOSED: "good",
  REQUESTED: "warn",
  INFO_REQUESTED: "warn",
  OVERDUE: "bad",
  REJECTED: "bad",
  EXPIRED: "bad",
  LOST: "bad",
};

export function ReturnTable({
  items,
}: {
  items: ReadonlyArray<AdminReturnListItem>;
}) {
  if (items.length === 0) {
    return <p className={styles.empty}>No returns match these filters.</p>;
  }
  return (
    <TableWrap label="Returns">
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Return</th>
            <th scope="col">Requested</th>
            <th scope="col">Status</th>
            <th scope="col">Due</th>
            <th scope="col">Customer</th>
            <th scope="col" className={styles.num}>
              Units
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <Link
                  href={routes.adminReturn(item.id)}
                  className={styles.rowLink}
                >
                  {item.requestNumber}
                </Link>
                <div className={styles.muted}>{item.orderNumber}</div>
              </td>
              <td>{formatDateTime(item.createdAt)}</td>
              <td>
                <Badge tone={RETURN_TONES[item.status]}>
                  {item.statusLabel}
                </Badge>
              </td>
              <td>
                {item.dueAt && item.dueLabel ? (
                  <>
                    {item.dueLabel}
                    <div className={styles.muted}>
                      {formatDateTime(item.dueAt)}
                    </div>
                  </>
                ) : (
                  <span className={styles.muted}>—</span>
                )}
              </td>
              <td>
                {item.recipientName}
                <div className={styles.muted}>{item.emailMasked}</div>
              </td>
              <td className={styles.num}>{item.units}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
