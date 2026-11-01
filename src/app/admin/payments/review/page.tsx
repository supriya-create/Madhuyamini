import type { Metadata } from "next";

import { AdminPageHeader } from "@/components/admin/AdminShell";
import { OrderTable } from "@/components/admin/orders/OrderTable";
import { getReviewQueue } from "@/features/admin/payments/service";
import { requireStaffSession } from "@/server/auth/staff";

export const metadata: Metadata = { title: "Payment review" };

/** Orders whose payment needs a person (docs/admin.md §5.5). */
export default async function PaymentReviewPage() {
  const ctx = await requireStaffSession();
  const items = await getReviewQueue(ctx);
  return (
    <div>
      <AdminPageHeader
        title="Payment review"
        lede={
          items.length === 0
            ? "No orders are waiting for a payment decision."
            : `${items.length} ${items.length === 1 ? "order needs" : "orders need"} a decision. Open an order to re-check with the provider, attach a payment, accept the captured amount, or cancel and refund. Oldest first.`
        }
      />
      <OrderTable items={items} />
    </div>
  );
}
