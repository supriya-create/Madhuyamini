import type { Metadata } from "next";

import { AccountShell } from "@/components/account/AccountShell";
import shellStyles from "@/components/account/AccountShell.module.css";
import { EmptyState } from "@/components/catalog/EmptyState";
import { OrderList } from "@/components/orders/OrderList";
import { listOrderSummaries } from "@/features/orders/service";
import { routes } from "@/lib/routes";
import { requireUser } from "@/server/auth/current-user";

export const metadata: Metadata = {
  title: "Orders",
  robots: { index: false, follow: false },
};

export default async function OrdersPage() {
  const user = await requireUser();
  const orders = await listOrderSummaries(user.id);
  return (
    <AccountShell user={user} title="Orders">
      {orders.length === 0 ? (
        <EmptyState
          heading="No orders yet"
          action={{ label: "Browse the collections", href: routes.collections }}
        >
          <p>Orders you place will be listed here with their progress.</p>
        </EmptyState>
      ) : (
        <div className={shellStyles.panel}>
          <OrderList orders={orders} />
        </div>
      )}
    </AccountShell>
  );
}
