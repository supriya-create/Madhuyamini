import Link from "next/link";

import type { Announcement } from "@/content/site";

import styles from "./AnnouncementBar.module.css";

/** A single line of real, current information. Never a marquee or carousel. */
export function AnnouncementBar({
  announcement,
}: {
  announcement: Announcement;
}) {
  return (
    <aside aria-label="Announcement" className={styles.bar}>
      {announcement.href ? (
        <Link href={announcement.href} className={styles.message}>
          {announcement.message}
        </Link>
      ) : (
        <p className={styles.message}>{announcement.message}</p>
      )}
    </aside>
  );
}
