import type { ConstructionMethod, Technique } from "@/generated/prisma/enums";

/** Customer-facing names for catalog enums. Safe to import on the client. */

export const techniqueLabels: Readonly<Record<Technique, string>> = {
  HAND_PAINTED: "Hand-painted",
  HAND_BLOCK_PRINTED: "Hand block-printed",
  SCREEN_PRINTED: "Screen-printed",
  DIGITAL_PRINT: "Digital print",
  EMBROIDERED: "Embroidered",
  APPLIQUE: "Appliqué",
};

export const constructionMethodLabels: Readonly<
  Record<ConstructionMethod, string>
> = {
  HANDWOVEN: "Handwoven",
  MILL_WOVEN: "Mill-woven",
  HAND_STITCHED: "Hand-stitched",
  MACHINE_STITCHED: "Machine-stitched",
  HANDMADE_PAPER: "Handmade paper",
  STRETCHED_CANVAS: "Stretched canvas",
  FRAMED: "Framed",
};

export const techniqueValues = Object.keys(
  techniqueLabels,
) as readonly Technique[];
