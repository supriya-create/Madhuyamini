"use client";

import { ChevronDown, Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { Icon } from "@/components/ui/Icon";
import type { NavCategory, NavLink } from "@/content/navigation";

import styles from "./MobileNav.module.css";

type MobileNavProps = {
  categories: readonly NavCategory[];
  extras: readonly NavLink[];
};

const DIALOG_ID = "mobile-menu";
const TITLE_ID = "mobile-menu-title";

/**
 * Navigation drawer for small screens, built on the native modal <dialog>:
 * the browser provides focus containment, Escape to close, an inert
 * background and focus return to the trigger.
 */
export function MobileNav({ categories, extras }: MobileNavProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const open = () => dialogRef.current?.showModal();
  const close = () => dialogRef.current?.close();
  // Browsers restore focus to the previously focused element, but Safari does
  // not focus buttons on tap, so that element is often <body>. Return it explicitly.
  const restoreFocus = () => triggerRef.current?.focus();

  // The trigger is hidden on wide screens; never leave an open modal behind it.
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 64em)");
    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) dialogRef.current?.close();
    };
    desktop.addEventListener("change", handleChange);
    return () => desktop.removeEventListener("change", handleChange);
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-controls={DIALOG_ID}
        onClick={open}
      >
        <Icon icon={Menu} size={24} />
        <span className="visually-hidden">Menu</span>
      </button>

      <dialog
        id={DIALOG_ID}
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby={TITLE_ID}
        onClose={restoreFocus}
      >
        <div className={styles.head}>
          <h2 id={TITLE_ID} className={styles.title}>
            Menu
          </h2>
          <button type="button" className={styles.close} onClick={close}>
            <Icon icon={X} size={24} />
            <span className="visually-hidden">Close menu</span>
          </button>
        </div>

        <nav aria-label="Main">
          <ul className={styles.list}>
            {categories.map((category) => (
              <li key={category.id}>
                <details className={styles.group}>
                  <summary className={styles.summary}>
                    {category.label}
                    <Icon
                      icon={ChevronDown}
                      size={20}
                      className={styles.chevron}
                    />
                  </summary>
                  <ul className={styles.subList}>
                    <li>
                      <Link
                        href={category.href}
                        className={styles.subLink}
                        onClick={close}
                      >
                        All {category.label.toLowerCase()}
                      </Link>
                    </li>
                    {category.children.map((child) => (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          className={styles.subLink}
                          onClick={close}
                        >
                          {child.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
            {extras.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={styles.extraLink}
                  onClick={close}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </dialog>
    </>
  );
}
