import type { Technique } from "@/generated/prisma/enums";
import { techniqueLabels } from "@/features/catalog/labels";

import styles from "./TechniqueList.module.css";

/** "Hand-painted · Embroidered" */
export function TechniqueList({
  techniques,
}: {
  techniques: readonly Technique[];
}) {
  return (
    <span className={styles.list}>
      {techniques.map((technique) => techniqueLabels[technique]).join(" · ")}
    </span>
  );
}
