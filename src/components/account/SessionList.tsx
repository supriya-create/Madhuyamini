import { Button } from "@/components/ui/Button";
import {
  revokeOtherSessionsAction,
  revokeSessionAction,
  signOutEverywhereAction,
} from "@/features/account/actions";
import type { SessionSummary } from "@/features/account/service";

import styles from "./AccountShell.module.css";

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

function describeAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Safari\//.test(userAgent) && !/Chrome/.test(userAgent)
        ? "Safari"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : "Browser";
  const platform = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Macintosh/.test(userAgent)
        ? "Mac"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return platform ? `${browser} on ${platform}` : browser;
}

export function SessionList({
  sessions,
}: {
  sessions: readonly SessionSummary[];
}) {
  return (
    <>
      <ul className={styles.sessionList}>
        {sessions.map((session) => (
          <li key={session.token} className={styles.session}>
            <p>
              <strong>{describeAgent(session.userAgent)}</strong>
              {session.isCurrent ? " · this device" : ""}
            </p>
            <p className={styles.sessionMeta}>
              Signed in {dateFormat.format(session.createdAt)} · expires{" "}
              {dateFormat.format(session.expiresAt)}
            </p>
            {!session.isCurrent ? (
              <form action={revokeSessionAction}>
                <input type="hidden" name="token" value={session.token} />
                <Button
                  type="submit"
                  variant="quiet"
                  className={styles.linkButton}
                >
                  Sign out this device
                </Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      <div className={styles.cardActions}>
        {sessions.length > 1 ? (
          <form action={revokeOtherSessionsAction}>
            <Button type="submit" variant="secondary">
              Sign out other devices
            </Button>
          </form>
        ) : null}
        <form action={signOutEverywhereAction}>
          <Button type="submit" variant="secondary">
            Sign out everywhere
          </Button>
        </form>
      </div>
    </>
  );
}
