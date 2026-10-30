/**
 * Site-wide brand details.
 *
 * Fields left `null` or empty are deliberately unset until the owner supplies
 * real information (docs/roadmap.md, "Inputs needed"). Components hide the
 * corresponding UI rather than show invented contact details or offers.
 */

export interface Announcement {
  readonly message: string;
  readonly href?: string;
}

export interface ContactDetails {
  readonly email: string;
  readonly phone?: string;
  readonly hours?: string;
}

export interface SocialLink {
  readonly network: string;
  readonly href: string;
}

export interface SiteConfig {
  readonly name: string;
  readonly description: string;
  readonly announcement: Announcement | null;
  readonly contact: ContactDetails | null;
  readonly social: readonly SocialLink[];
}

export const site: SiteConfig = {
  name: "Madhuyamini",
  description:
    "Madhubani-inspired clothing, wall art and home décor, drawn from the painted tradition of Mithila.",
  announcement: null,
  contact: null,
  social: [],
};
