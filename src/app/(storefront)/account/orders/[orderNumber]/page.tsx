import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AccountShell } from "@/components/account/AccountShell";
import shellStyles from "@/components/account/AccountShell.module.css";
import { OrderDetail } from "@/components/orders/OrderDetail";
import { ReturnEntryPanel } from "@/components/returns/ReturnEntryPanel";
import { getReturnsPolicy } from "@/config/returns-policy";
import { getOrderViewByNumber } from "@/features/orders/service";
import {
  getReturnEligibility,
  listReturnsForOrder,
} from "@/features/returns/service";
import { requireUser } from "@/server/auth/current-user";

export const metadata: Metadata = {
  title: "Order",
  robots: { index: false, follow: false },
};

export default async function OrderPage({
  params,
}: PageProps<"/account/orders/[orderNumber]">) {
  const [user, { orderNumber }] = await Promise.all([requireUser(), params]);
  const view = await getOrderViewByNumber(user.id, orderNumber);
  if (!view) notFound();
  const [eligibility, returns] = await Promise.all([
    getReturnEligibility(user, view.orderNumber),
    listReturnsForOrder(user, view.id),
  ]);
  return (
    <AccountShell user={user} title={`Order ${view.orderNumber}`}>
      <div className={shellStyles.panel}>
        <OrderDetail view={view} showTimeline />
        {eligibility ? (
          <ReturnEntryPanel
            eligibility={eligibility}
            returns={returns}
            windowDays={getReturnsPolicy().windowDays}
          />
        ) : null}
      </div>
    </AccountShell>
  );
}
