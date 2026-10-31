import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AccountShell } from "@/components/account/AccountShell";
import shellStyles from "@/components/account/AccountShell.module.css";
import { OrderDetail } from "@/components/orders/OrderDetail";
import { getOrderViewByNumber } from "@/features/orders/service";
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
  return (
    <AccountShell user={user} title={`Order ${view.orderNumber}`}>
      <div className={shellStyles.panel}>
        <OrderDetail view={view} showTimeline />
      </div>
    </AccountShell>
  );
}
