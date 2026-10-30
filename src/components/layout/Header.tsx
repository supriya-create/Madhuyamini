import Link from "next/link";

import { navCategories, navExtras } from "@/content/navigation";
import { site } from "@/content/site";
import { routes } from "@/lib/routes";

import { DesktopNav } from "./DesktopNav";
import styles from "./Header.module.css";
import { MobileNav } from "./MobileNav";

export function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <div className={styles.start}>
          <MobileNav categories={navCategories} extras={navExtras} />
        </div>
        <Link
          href={routes.home}
          className={styles.wordmark}
          aria-label={`${site.name}, home`}
        >
          {site.name}
        </Link>
        {/* Search, account, wishlist and cart are added here as those features ship. */}
        <div className={styles.end} />
      </div>
      <DesktopNav categories={navCategories} extras={navExtras} />
    </header>
  );
}
