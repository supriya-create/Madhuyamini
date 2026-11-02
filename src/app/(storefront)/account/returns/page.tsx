import type { Metadata } from "next";

import { AccountShell } from "@/components/account/AccountShell";
import shellStyles from "@/components/account/AccountShell.module.css";
import { EmptyState } from "@/components/catalog/EmptyState";
import { ReturnList } from "@/components/returns/ReturnList";
import { listReturnSummaries } from "@/features/returns/service";
import { requireUser } from "@/server/auth/current-user";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Returns",
  robots: { index: false, follow: false },
};

export default async function ReturnsPage() {
  const user = await requireUser();
  const returns = await listReturnSummaries(user);
  return (
    <AccountShell user={user} title="Returns">
      {returns.length === 0 ? (
        <EmptyState
          heading="No returns"
          action={{ label: "See your orders", href: routes.accountOrders }}
        >
          <p>
            To return or exchange something, open the delivered order and choose
            the items.
          </p>
        </EmptyState>
      ) : (
        <div className={shellStyles.panel}>
          <ReturnList returns={returns} />
        </div>
      )}
    </AccountShell>
  );
}
