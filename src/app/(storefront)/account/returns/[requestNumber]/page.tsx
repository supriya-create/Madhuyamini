import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AccountShell } from "@/components/account/AccountShell";
import shellStyles from "@/components/account/AccountShell.module.css";
import { ReturnDetail } from "@/components/returns/ReturnDetail";
import styles from "@/components/returns/Returns.module.css";
import { getReturnsPolicy } from "@/config/returns-policy";
import { getReturnView } from "@/features/returns/service";
import { requireUser } from "@/server/auth/current-user";
import { env } from "@/server/env";

export const metadata: Metadata = {
  title: "Return",
  robots: { index: false, follow: false },
};

const NOTICES: Readonly<Record<string, string>> = {
  requested:
    "Your return request has been sent. We will review it and email you.",
  withdrawn: "Your request has been withdrawn.",
  shipped: "Thank you; we will let you know when the parcel arrives.",
};

export default async function ReturnPage({
  params,
  searchParams,
}: PageProps<"/account/returns/[requestNumber]">) {
  const [user, { requestNumber }, query] = await Promise.all([
    requireUser(),
    params,
    searchParams,
  ]);
  const view = await getReturnView(user, requestNumber);
  if (!view) notFound();
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  return (
    <AccountShell user={user} title={`Return ${view.requestNumber}`}>
      <div className={shellStyles.panel}>
        {notice ? (
          <p role="status" className={styles.notice}>
            {notice}
          </p>
        ) : null}
        <ReturnDetail
          view={view}
          maxEvidence={getReturnsPolicy().evidence.maxPerRequest}
          uploadsAvailable={env.cloudinary !== null}
        />
      </div>
    </AccountShell>
  );
}
