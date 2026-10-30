import { routes } from "@/lib/routes";

/**
 * Homepage editorial copy.
 *
 * DRAFT — awaiting owner review. The copy makes no factual claims about the
 * business (founding story, artists, volumes). Heritage facts describe the
 * Madhubani tradition generally and should be reviewed with the brand's artists.
 */

export const hero = {
  eyebrow: "Madhubani · Mithila",
  heading: "Madhubani, in every thread and frame",
  lead: "Clothing, wall art and pieces for the home, drawn from the painted tradition of Mithila: its double-line borders, its fish and peacocks, its fearless reds and ochres.",
  primaryAction: { label: "Explore the collections", href: routes.collections },
  secondaryAction: { label: "Read about the tradition", href: routes.heritage },
  imageDescription:
    "Hero photograph: a signature Madhuyamini piece, shot in natural light",
} as const;

export const introduction = {
  heading: "Old lines, new canvases",
  body: "Madhuyamini brings the visual language of Madhubani painting to clothing, wall art and the home. Each design starts from the tradition’s own grammar (the bordered frame, the hatched fill, the fish, the peacock and the lotus) and asks how it might live on a saree’s pallu, a cushion or a framed print.",
} as const;

export const heritage = {
  eyebrow: "The tradition",
  heading: "A painted language from Mithila",
  paragraphs: [
    "Madhubani painting, also called Mithila painting, comes from the Mithila region, which spans northern Bihar in India and the neighbouring plains of Nepal. For generations it was made by women, painted on the freshly plastered walls and floors of their homes to mark weddings, births and festivals.",
    "After the 1934 Bihar–Nepal earthquake, the British official William G. Archer saw paintings on the inner walls of damaged homes and later wrote about them, bringing them to wider attention. In the late 1960s, during a severe drought, artists were encouraged to paint on paper so the work could be sold, and it began to travel far beyond the villages where it was made.",
  ],
  stylesHeading: "Five styles",
  styles: [
    {
      name: "Bharni",
      meaning: "Filled",
      description: "Bold areas of colour inside crisp black outlines.",
    },
    {
      name: "Kachni",
      meaning: "Line",
      description:
        "Fine hatching and linework, often in just one or two colours.",
    },
    {
      name: "Tantrik",
      meaning: "Devotional",
      description: "Deities and sacred symbols drawn from Tantric traditions.",
    },
    {
      name: "Godna",
      meaning: "Tattoo",
      description:
        "Rows of repeated motifs that echo traditional body tattoos.",
    },
    {
      name: "Kohbar",
      meaning: "Marriage",
      description:
        "Paintings for the nuptial chamber, dense with symbols of love and fertility.",
    },
  ],
} as const;

export const craftsmanship = {
  eyebrow: "Craft and authenticity",
  heading: "What every piece will tell you",
  principles: [
    {
      title: "The technique, named",
      body: "Every product states how it was made: hand-painted, hand-printed, digitally printed or embroidered. A print is never presented as a painting.",
    },
    {
      title: "Materials and care, in plain words",
      body: "Fabric, size and how to look after it, set out on every product page before you buy.",
    },
    {
      title: "Originals, marked as originals",
      body: "When a piece is a single hand-painted original, it says so, and it is sold only once.",
    },
  ],
} as const;
