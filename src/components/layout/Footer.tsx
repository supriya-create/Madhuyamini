import Link from "next/link";

import { Container } from "@/components/ui/Container";
import { MotifDivider } from "@/components/motifs/MotifDivider";
import { navCategories } from "@/content/navigation";
import { site } from "@/content/site";
import { routes } from "@/lib/routes";

import styles from "./Footer.module.css";

const helpLinks = [
  { label: "Shipping and delivery", href: routes.policy("shipping") },
  { label: "Returns and exchanges", href: routes.policy("returns") },
  { label: "Care guide", href: routes.careGuide },
  { label: "Contact us", href: routes.contact },
] as const;

const legalLinks = [
  { label: "Privacy policy", href: routes.policy("privacy") },
  { label: "Terms of service", href: routes.policy("terms") },
] as const;

export function Footer() {
  const { contact, social } = site;

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
                {navCategories.map((category) => (
                  <li key={category.id}>
                    <Link href={category.href}>{category.label}</Link>
                  </li>
                ))}
                <li>
                  <Link href={routes.customArtwork}>Custom artwork</Link>
                </li>
              </ul>
            </div>

            <div>
              <h2 className={styles.columnTitle}>Help</h2>
              <ul className={styles.links}>
                {helpLinks.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>

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
          <ul className={styles.legalLinks}>
            {legalLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </footer>
  );
}
