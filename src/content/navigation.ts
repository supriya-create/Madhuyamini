import { routes } from "@/lib/routes";

/**
 * Category navigation, matching the agreed product taxonomy.
 * Phase 3 moves this to the Category table so merchandisers can edit it.
 */

export interface NavLink {
  readonly label: string;
  readonly href: string;
  /** Category slug, when the link targets a collection. */
  readonly slug?: string;
  /**
   * False while the destination is still to be built (its prefix is listed in
   * e2e/pending-routes.ts). Unavailable links are kept here, not rendered, so
   * nothing visible ever leads to a 404 and the phase that ships the page
   * only has to flip this flag.
   */
  readonly available?: boolean;
}

/** Links worth rendering: everything not explicitly marked unavailable. */
export function isAvailableLink(link: NavLink): boolean {
  return link.available !== false;
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
      slug,
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

/** Phase 8 (custom artwork commissions) ships this page; hidden until then. */
export const customArtworkLink: NavLink = {
  label: "Custom artwork",
  href: routes.customArtwork,
  available: false,
};

/** Top-level links shown alongside the categories. */
export const navExtras: readonly NavLink[] = [
  customArtworkLink,
  { label: "Heritage", href: routes.heritage },
];

/**
 * Footer help links. The policy, care and contact pages arrive with Phase 9,
 * which Razorpay's live activation also needs (docs/roadmap.md), so they are
 * hidden rather than stubbed: no placeholder page, no invented policy text.
 */
export const helpLinks: readonly NavLink[] = [
  {
    label: "Shipping and delivery",
    href: routes.policy("shipping"),
    available: false,
  },
  {
    label: "Returns and exchanges",
    href: routes.policy("returns"),
    available: false,
  },
  { label: "Care guide", href: routes.careGuide, available: false },
  { label: "Contact us", href: routes.contact, available: false },
];

/** Footer legal links; Phase 9 as above. */
export const legalLinks: readonly NavLink[] = [
  { label: "Privacy policy", href: routes.policy("privacy"), available: false },
  { label: "Terms of service", href: routes.policy("terms"), available: false },
];
