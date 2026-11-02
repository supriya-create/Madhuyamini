import type { Metadata } from "next";
import { notFound } from "next/navigation";

import styles from "@/components/admin/Admin.module.css";
import { AdminPageHeader } from "@/components/admin/AdminShell";
import { Badge } from "@/components/admin/orders/StatusBadge";
import { ReturnActions } from "@/components/admin/returns/ReturnActions";
import {
  ReturnCustomerPanel,
  ReturnEvidencePanel,
  ReturnHistoryPanel,
  ReturnItemsPanel,
  ReturnMessagesPanel,
  ReturnParcelsPanel,
  ReturnSummaryPanel,
} from "@/components/admin/returns/ReturnDetailPanels";
import { RETURN_TONES } from "@/components/admin/returns/ReturnTable";
import {
  RETURN_NOTICES,
  isReturnNotice,
} from "@/features/admin/returns/notices";
import { returnIdSchema } from "@/features/admin/returns/schemas";
import { getReturnDetail } from "@/features/admin/returns/service";
import { requireStaffSession } from "@/server/auth/staff";

export const metadata: Metadata = { title: "Return" };

export default async function AdminReturnPage({
  params,
  searchParams,
}: PageProps<"/admin/returns/[id]">) {
  const ctx = await requireStaffSession();
  const { id } = await params;
  const parsedId = returnIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const item = await getReturnDetail(ctx, parsedId.data);
  if (!item) notFound();
  const query = await searchParams;
  const notice = isReturnNotice(query.notice)
    ? RETURN_NOTICES[query.notice]
    : null;

  return (
    <div>
      <AdminPageHeader title={`Return ${item.requestNumber}`}>
        <div className={styles.headerMeta}>
          <Badge tone={RETURN_TONES[item.status]}>{item.statusLabel}</Badge>
          <span>Order {item.orderNumber}</span>
        </div>
      </AdminPageHeader>
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}
      <div className={styles.grid}>
        <div className={styles.actions}>
          <ReturnItemsPanel item={item} />
          <ReturnEvidencePanel item={item} />
          <ReturnParcelsPanel item={item} />
          <ReturnMessagesPanel item={item} />
          <ReturnHistoryPanel item={item} />
        </div>
        <div className={styles.actions}>
          <ReturnActions item={item} />
          <ReturnSummaryPanel item={item} />
          <ReturnCustomerPanel item={item} />
        </div>
      </div>
    </div>
  );
}
