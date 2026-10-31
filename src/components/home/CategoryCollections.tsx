import Link from "next/link";

import { MotifDivider } from "@/components/motifs/MotifDivider";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Section } from "@/components/ui/Section";
import { getCategoryTree } from "@/features/catalog/service";
import { routes } from "@/lib/routes";

import styles from "./CategoryCollections.module.css";

/** Top-level categories with their sub-categories, from the database. */
export async function CategoryCollections() {
  const tree = await getCategoryTree();
  if (tree.length === 0) return null;

  return (
    <Section labelledBy="collections-heading" className={styles.section}>
      <Container>
        <div className={styles.header}>
          <Eyebrow>Collections</Eyebrow>
          <h2 id="collections-heading">Shop by collection</h2>
        </div>
        <ul className={styles.groups}>
          {tree.map((category) => (
            <li key={category.id} className={styles.group}>
              <MotifDivider />
              <h3 className={styles.title}>
                <Link
                  href={routes.collection(category.slug)}
                  className={styles.link}
                >
                  {category.name}
                </Link>
              </h3>
              <ul className={styles.children}>
                {category.children.map((child) => (
                  <li key={child.id}>
                    <Link
                      href={routes.collection(child.slug)}
                      className={styles.childLink}
                    >
                      {child.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
