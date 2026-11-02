import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AccountShell } from "@/components/account/AccountShell";
import shellStyles from "@/components/account/AccountShell.module.css";
import { ReturnRequestForm } from "@/components/returns/ReturnRequestForm";
import styles from "@/components/returns/Returns.module.css";
import { getReturnsPolicy } from "@/config/returns-policy";
import { getReturnEligibility } from "@/features/returns/service";
import { requireUser } from "@/server/auth/current-user";
import { env } from "@/server/env";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Return items",
  robots: { index: false, follow: false },
};

export default async function ReturnRequestPage({
  params,
}: PageProps<"/account/orders/[orderNumber]/return">) {
  const [user, { orderNumber }] = await Promise.all([requireUser(), params]);
  const eligibility = await getReturnEligibility(user, orderNumber);
  if (!eligibility) notFound();
  const policy = getReturnsPolicy();
  return (
    <AccountShell
      user={user}
      title={`Return items from ${eligibility.orderNumber}`}
    >
      <div className={shellStyles.panel}>
        {eligibility.canRequest ? (
          <>
            <p className={styles.muted}>
              Choose what to send back. We will review the request and email you
              instructions; nothing needs to be posted until then.
              {eligibility.windowClosesAt
                ? ` The return window closes on ${eligibility.windowClosesAt.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}.`
                : ""}
            </p>
            <ReturnRequestForm
              orderNumber={eligibility.orderNumber}
              operationKey={crypto.randomUUID()}
              lines={eligibility.lines}
              evidenceRequiredForReasons={
                eligibility.evidenceRequiredForReasons
              }
              uploadsAvailable={env.cloudinary !== null}
              maxEvidence={policy.evidence.maxPerRequest}
            />
          </>
        ) : (
          <>
            <p role="status" className={styles.notice}>
              {eligibility.hasOpenRequest
                ? "A return request for this order is already open."
                : eligibility.deliveredAt
                  ? "Nothing from this order can be returned right now."
                  : "Items can be returned once the order has been delivered."}
            </p>
            <p>
              <Link href={routes.accountOrder(eligibility.orderNumber)}>
                Back to the order
              </Link>
            </p>
          </>
        )}
      </div>
    </AccountShell>
  );
}
