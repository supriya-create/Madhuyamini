import { Search, ShoppingBag, UserRound } from "lucide-react";
import Link from "next/link";

import { SearchForm } from "@/components/catalog/SearchForm";
import { Icon } from "@/components/ui/Icon";
import { navExtras } from "@/content/navigation";
import type { NavCategory } from "@/content/navigation";
import { site } from "@/content/site";
import { getCategoryTree } from "@/features/catalog/service";
import { getCartItemCount } from "@/features/cart/service";
import { getCurrentUser } from "@/server/auth/current-user";
import { resolveCartContext } from "@/server/cart/context";
import type { CategoryNode } from "@/features/catalog/types";
import { routes } from "@/lib/routes";

import { DesktopNav } from "./DesktopNav";
import styles from "./Header.module.css";
import { MobileNav } from "./MobileNav";

/** Navigation is driven by the Category table; admins will edit it in Phase 7. */
function toNavCategory(node: CategoryNode): NavCategory {
  return {
    id: node.slug,
    label: node.name,
    href: routes.collection(node.slug),
    children: node.children.map((child) => ({
      label: child.name,
      href: routes.collection(child.slug),
      slug: child.slug,
    })),
  };
}

export async function Header() {
  const [tree, user, cartCount] = await Promise.all([
    getCategoryTree(),
    getCurrentUser(),
    resolveCartContext().then(getCartItemCount),
  ]);
  const categories = tree.map(toNavCategory);

  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <div className={styles.start}>
          <MobileNav
            categories={categories}
            extras={navExtras}
            searchSlot={<SearchForm id="mobile-search" variant="prominent" />}
          />
        </div>
        <Link
          href={routes.home}
          className={styles.wordmark}
          aria-label={`${site.name}, home`}
        >
          {site.name}
        </Link>
        <div className={styles.end}>
          <div className={styles.desktopSearch}>
            <SearchForm id="header-search" />
          </div>
          <Link href={routes.search} className={styles.iconLink}>
            <Icon icon={Search} size={24} />
            <span className="visually-hidden">Search</span>
          </Link>
          <Link
            href={user ? routes.account : routes.login}
            className={styles.iconLink}
            data-account
          >
            <Icon icon={UserRound} size={24} />
            <span className="visually-hidden">
              {user ? "Your account" : "Sign in"}
            </span>
          </Link>
          <Link
            href={routes.cart}
            className={styles.iconLink}
            data-account
            data-cart
          >
            <Icon icon={ShoppingBag} size={24} />
            <span className="visually-hidden">
              Cart, {cartCount} {cartCount === 1 ? "item" : "items"}
            </span>
            {cartCount > 0 ? (
              <span aria-hidden="true" className={styles.badge}>
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            ) : null}
          </Link>
        </div>
      </div>
      <DesktopNav categories={categories} extras={navExtras} />
    </header>
  );
}
