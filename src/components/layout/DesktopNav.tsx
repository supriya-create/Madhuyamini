"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FocusEvent } from "react";

import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import type { NavCategory, NavLink } from "@/content/navigation";

import styles from "./DesktopNav.module.css";

type DesktopNavProps = {
  categories: readonly NavCategory[];
  extras: readonly NavLink[];
};

/**
 * Category navigation for wide screens, using the disclosure pattern: each
 * category is a button that shows or hides its panel of links. (ARIA `menu`
 * roles are for application menus, not site navigation.)
 */
export function DesktopNav({ categories, extras }: DesktopNavProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (openId === null) return;

    function handlePointerDown(event: PointerEvent) {
      const nav = navRef.current;
      if (nav && event.target instanceof Node && !nav.contains(event.target)) {
        setOpenId(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || openId === null) return;
      setOpenId(null);
      triggerRefs.current.get(openId)?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openId]);

  function handleBlur(event: FocusEvent<HTMLElement>) {
    const next = event.relatedTarget;
    // Close only when focus moves to another element outside the nav. A null
    // target (Safari clicking a link it won't focus, switching windows) must not
    // close the panel mid-click; outside clicks and Escape are handled above.
    if (next instanceof Node && !event.currentTarget.contains(next)) {
      setOpenId(null);
    }
  }

  const close = () => setOpenId(null);

  return (
    <nav
      aria-label="Main"
      className={styles.nav}
      ref={navRef}
      onBlur={handleBlur}
    >
      <ul className={styles.list}>
        {categories.map((category) => {
          const isOpen = openId === category.id;
          const panelId = `nav-panel-${category.id}`;
          return (
            <li key={category.id}>
              <button
                type="button"
                className={styles.trigger}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpenId(isOpen ? null : category.id)}
                ref={(node) => {
                  if (node) triggerRefs.current.set(category.id, node);
                  else triggerRefs.current.delete(category.id);
                }}
              >
                {category.label}
                <Icon icon={ChevronDown} size={16} className={styles.chevron} />
              </button>
              <div id={panelId} className={styles.panel} hidden={!isOpen}>
                <Container className={styles.panelInner}>
                  <Link
                    href={category.href}
                    className={styles.panelAll}
                    onClick={close}
                  >
                    All {category.label.toLowerCase()}
                  </Link>
                  <ul className={styles.panelList}>
                    {category.children.map((child) => (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          className={styles.panelLink}
                          onClick={close}
                        >
                          {child.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Container>
              </div>
            </li>
          );
        })}
        {extras.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className={styles.link}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
