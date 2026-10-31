import type { Metadata } from "next";
import Link from "next/link";

import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";
import { Container } from "@/components/ui/Container";
import { getCategoryTree } from "@/features/catalog/service";
import { routes } from "@/lib/routes";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Collections",
  description:
    "Madhubani-inspired clothing, wall art, home décor and accessories, by category.",
};

export default async function CollectionsPage() {
  const tree = await getCategoryTree();

  return (
    <Container className={styles.page}>
      <header className={styles.header}>
        <Breadcrumbs items={[{ label: "Collections" }]} />
        <h1>Collections</h1>
        <p className={styles.intro}>
          Every piece, grouped by what it is and where it lives.
        </p>
      </header>

      <ul className={styles.groups}>
        {tree.map((category) => (
          <li key={category.id} className={styles.group}>
            <h2 className={styles.groupTitle}>
              <Link
                href={routes.collection(category.slug)}
                className={styles.groupLink}
              >
                {category.name}
              </Link>
            </h2>
            {category.description ? (
              <p className={styles.groupIntro}>{category.description}</p>
            ) : null}
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
  );
}
