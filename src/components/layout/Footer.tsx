import Link from "next/link";

import { Container } from "@/components/ui/Container";
import { MotifDivider } from "@/components/motifs/MotifDivider";
import {
  customArtworkLink,
  helpLinks,
  isAvailableLink,
  legalLinks,
} from "@/content/navigation";
import { site } from "@/content/site";
import { getCategoryTree } from "@/features/catalog/service";
import { routes } from "@/lib/routes";

import styles from "./Footer.module.css";

/**
 * Footer navigation. The shop column reads the same category tree as the
 * header (one query per request, memoised), so merchandising changes never
 * leave a stale footer link. Help and legal links appear only once their
 * pages exist (Phase 9); an empty column is not rendered at all.
 */
export async function Footer() {
  const { contact, social } = site;
  const tree = await getCategoryTree();
  const shopLinks = [
    ...tree.map((category) => ({
      label: category.name,
      href: routes.collection(category.slug),
    })),
    ...[customArtworkLink].filter(isAvailableLink),
  ];
  const help = helpLinks.filter(isAvailableLink);
  const legal = legalLinks.filter(isAvailableLink);

  return (
    <footer data-surface="ink" className={styles.footer}>
      <Container>
        <MotifDivider />

        <div className={styles.grid}>
          <div className={styles.brand}>
            <p className={styles.wordmark}>{site.name}</p>
            <p className={styles.statement}>{site.description}</p>
          </div>

          <nav aria-label="Footer" className={styles.columns}>
            <div>
              <h2 className={styles.columnTitle}>Shop</h2>
              <ul className={styles.links}>
                {shopLinks.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>

            {help.length > 0 ? (
              <div>
                <h2 className={styles.columnTitle}>Help</h2>
                <ul className={styles.links}>
                  {help.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href}>{link.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div>
              <h2 className={styles.columnTitle}>Madhuyamini</h2>
              <ul className={styles.links}>
                <li>
                  <Link href={routes.heritage}>The Madhubani tradition</Link>
                </li>
                {social.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} rel="noopener noreferrer">
                      {link.network}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {contact ? (
              <div>
                <h2 className={styles.columnTitle}>Contact</h2>
                <ul className={styles.links}>
                  <li>
                    <a href={`mailto:${contact.email}`}>{contact.email}</a>
                  </li>
                  {contact.phone ? (
                    <li>
                      <a href={`tel:${contact.phone.replace(/\s+/g, "")}`}>
                        {contact.phone}
                      </a>
                    </li>
                  ) : null}
                  {contact.hours ? <li>{contact.hours}</li> : null}
                </ul>
              </div>
            ) : null}
          </nav>
        </div>

        <div className={styles.legal}>
          <p>
            © {new Date().getFullYear()} {site.name}
          </p>
          {legal.length > 0 ? (
            <ul className={styles.legalLinks}>
              {legal.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Container>
    </footer>
  );
}
