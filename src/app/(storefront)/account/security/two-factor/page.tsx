import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AccountShell } from "@/components/account/AccountShell";
import shellStyles from "@/components/account/AccountShell.module.css";
import { RecoveryCodesForm } from "@/components/admin/RecoveryCodesForm";
import { TwoFactorEnrolForm } from "@/components/admin/TwoFactorEnrolForm";
import styles from "@/components/admin/TwoFactor.module.css";
import formStyles from "@/components/forms/Form.module.css";
import { PasswordField } from "@/components/forms/PasswordField";
import { Button } from "@/components/ui/Button";
import { beginEnrolmentAction } from "@/features/admin/security/actions";
import {
  pendingEnrolment,
  securityStatus,
} from "@/features/admin/security/service";
import { safeReturnPath } from "@/features/auth/schemas";
import { requireUser } from "@/server/auth/current-user";
import { formatDateTime } from "@/lib/dates";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Two-factor sign-in",
  robots: { index: false, follow: false },
};

/** Only an error code travels in the URL; the wording lives here. */
const ERRORS: Readonly<Record<string, string>> = {
  TWO_FACTOR_PASSWORD: "That password is not right.",
  TWO_FACTOR_RATE_LIMITED:
    "Too many attempts. Please wait before trying again.",
  TWO_FACTOR_ALREADY_ENABLED:
    "Two-factor sign-in is already set up. Ask an admin to reset it if you lost your device.",
  TWO_FACTOR_NOT_CONFIGURED:
    "Second-factor sign-in is not configured on this server.",
  TWO_FACTOR_NOT_AVAILABLE: "Two-factor sign-in is for staff accounts.",
};

/**
 * Enrolment and status for the staff second factor (docs/admin.md §5.9).
 * There is no "turn off": a staff account without it cannot open the admin.
 */
export default async function TwoFactorPage({
  searchParams,
}: PageProps<"/account/security/two-factor">) {
  const user = await requireUser();
  if (user.role === "CUSTOMER") notFound();
  const query = await searchParams;
  const next = safeReturnPath(query.next, routes.admin);
  const status = await securityStatus(user);
  const pending = status.pending ? await pendingEnrolment(user) : null;
  const error =
    typeof query.error === "string"
      ? (ERRORS[query.error] ?? "That did not work. Please try again.")
      : null;

  return (
    <AccountShell user={user} title="Two-factor sign-in">
      {error ? (
        <p role="alert" className={shellStyles.notice}>
          {error}
        </p>
      ) : null}
      {status.enabled ? (
        <div className={shellStyles.panel}>
          <h2 className={shellStyles.panelTitle}>Two-factor sign-in is on</h2>
          <div className={styles.meta}>
            <p>
              Since{" "}
              {status.enabledAt ? formatDateTime(status.enabledAt) : "now"}.
            </p>
            <p>
              Recovery codes left: {status.recoveryCodesRemaining}.{" "}
              {status.recoveryCodesRemaining <= 2
                ? "Ask an admin to reset your second factor to get a fresh set."
                : null}
            </p>
            <p>
              {status.sessionVerifiedAt
                ? `This session was confirmed at ${formatDateTime(status.sessionVerifiedAt)}.`
                : "This session has not been confirmed yet."}
            </p>
          </div>
          {status.sessionVerifiedAt ? null : (
            <p>
              <Link
                href={`${routes.loginVerify}?next=${encodeURIComponent(next)}`}
              >
                Confirm this session
              </Link>
            </p>
          )}
          <p className={styles.hint}>
            Lost your authenticator app? Use a recovery code to sign in, or ask
            an admin to reset your second factor so you can set it up again.
          </p>
          <details className={styles.details}>
            <summary>Issue new recovery codes</summary>
            <div>
              <RecoveryCodesForm />
            </div>
          </details>
        </div>
      ) : pending ? (
        <div className={shellStyles.panel}>
          <TwoFactorEnrolForm
            next={next}
            secretBase32={pending.secretBase32}
            uri={pending.uri}
          />
        </div>
      ) : (
        <div className={shellStyles.panel}>
          <h2 className={shellStyles.panelTitle}>Set up two-factor sign-in</h2>
          <p className={styles.hint}>
            Staff accounts confirm every session with a code from an
            authenticator app. You will get ten one-time recovery codes for when
            the app is not to hand. Setting up takes about a minute.
          </p>
          <form action={beginEnrolmentAction} className={formStyles.form}>
            <input type="hidden" name="next" value={next} />
            <PasswordField
              id="enrol-password"
              name="password"
              label="Current password"
              hint="Setting up a second factor starts with your password."
              autoComplete="current-password"
              required
            />
            <div className={formStyles.actions}>
              <Button type="submit">Start setup</Button>
            </div>
          </form>
        </div>
      )}
    </AccountShell>
  );
}
