import { routes } from "@/lib/routes";

/**
 * Category navigation, matching the agreed product taxonomy.
 * Phase 3 moves this to the Category table so merchandisers can edit it.
 */

export interface NavLink {
  readonly label: string;
  readonly href: string;
}

export interface NavCategory {
  readonly id: string;
  readonly label: string;
  /** Link to the category's landing page ("All clothing"). */
  readonly href: string;
  readonly children: readonly NavLink[];
}

function category(
  id: string,
  label: string,
  children: ReadonlyArray<readonly [string, string]>,
) {
  return {
    id,
    label,
    href: routes.collection(id),
    children: children.map(([slug, childLabel]) => ({
      label: childLabel,
      href: routes.collection(slug),
    })),
  } satisfies NavCategory;
}

export const navCategories: readonly NavCategory[] = [
  category("clothing", "Clothing", [
    ["sarees", "Sarees"],
    ["kurta-sets", "Kurta sets"],
    ["salwar-suits", "Salwar suits"],
    ["kurtis", "Kurtis"],
    ["dupattas", "Dupattas"],
    ["dress-materials", "Dress materials"],
    ["stoles", "Stoles"],
  ]),
  category("wall-art", "Wall Art", [
    ["posters", "Posters"],
    ["framed-paintings", "Framed paintings"],
    ["canvas-prints", "Canvas prints"],
    ["wall-hangings", "Wall hangings"],
  ]),
  category("home-decor", "Home Décor", [
    ["bedsheets", "Bedsheets"],
    ["cushion-covers", "Cushion covers"],
    ["pillow-covers", "Pillow covers"],
    ["curtains", "Curtains"],
    ["table-runners", "Table runners"],
    ["decorative-pieces", "Decorative pieces"],
  ]),
  category("accessories", "Accessories", [
    ["tote-bags", "Tote bags"],
    ["handbags", "Handbags"],
    ["jewellery", "Jewellery"],
    ["diaries", "Diaries"],
    ["notebooks", "Notebooks"],
    ["gift-sets", "Gift sets"],
  ]),
];

/** Top-level links shown alongside the categories. */
export const navExtras: readonly NavLink[] = [
  { label: "Custom artwork", href: routes.customArtwork },
  { label: "Heritage", href: routes.heritage },
];
