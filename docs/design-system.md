# Madhuyamini — Design System

Status: **Approved 31 Oct 2026.** Implemented in `src/styles/tokens.css` and `globals.css`. Live specimen at `/design-system` (development only).

Final sign-off on type and colour happens on a rendered specimen page in Phase 1. Fonts and colours read differently in a browser than in a document.

---

## 1. Direction

**An ivory page an artist has drawn on.** The interface stays warm, calm and quiet, so the products, the artworks and the artists' hands carry the colour. Madhubani's own visual grammar provides structure: double-line borders, _kachni_ line-hatching, and framed compositions.

### Principles

1. **Art first, interface second.** Photography and artwork carry the colour. The UI is ivory, ink and one red.
2. **Borrow structure, not clip art.** We use Madhubani's border logic (double rules, hatching, framed panels) for dividers and frames.
   - Figurative motifs (fish, peacock, lotus, sun, tree of life) come only from the brand's commissioned artists, traced to SVG and credited.
   - They are never AI-generated, never stock, and never improvised in code.
3. **Editorial rhythm.** Sections vary their composition (full-bleed image, split image and text, framed panel, offset grid). We don't repeat identical card grids down the page.
4. **Square, quiet geometry.**
   - Corners: 0 radius on images and panels, 2 px on controls.
   - Hairline borders instead of shadows.
   - No gradients, glassmorphism, glows, pill buttons or floating shapes.
5. **Motion only for orientation:** menus opening, drawers, feedback. 120–320 ms, opacity and transform only, and off under `prefers-reduced-motion`.

---

## 2. Colour

Contrast ratios below were computed with the WCAG 2.x relative-luminance formula. AA requires 4.5:1 for normal text, and 3:1 for large text and UI components.

| Token                     | Hex       | Role                                           | On ivory | On cream |
| ------------------------- | --------- | ---------------------------------------------- | -------- | -------- |
| `--color-ivory`           | `#FBF7EF` | Page background                                | n/a      | n/a      |
| `--color-cream`           | `#F4ECDD` | Alternate section background                   | n/a      | n/a      |
| `--color-sand`            | `#E7DAC2` | Decorative surfaces, hairline dividers         | n/a      | n/a      |
| `--color-ink`             | `#231A15` | Primary text, dark panels                      | 15.98    | 14.54    |
| `--color-umber`           | `#5A4335` | Secondary text                                 | 8.59     | 7.82     |
| `--color-muted`           | `#6E5A4A` | Tertiary text, metadata                        | 6.10     | 5.55     |
| `--color-sindoor`         | `#9B2D20` | Brand red: primary buttons, key links          | 7.04     | 6.41     |
| `--color-sindoor-deep`    | `#7A2118` | Hover and pressed                              | 9.55     | 8.69     |
| `--color-terracotta`      | `#B4583A` | Accent: large text (≥ 24 px) and ornament only | 4.47     | 4.07     |
| `--color-terracotta-text` | `#9A4529` | Accent for small text                          | 6.03     | 5.49     |
| `--color-gold`            | `#B08D3E` | Ornament lines; text **only on ink** (5.47)    | 2.92 ✗   | 2.66 ✗   |
| `--color-gold-text`       | `#7A5F22` | Gold-toned small text on light backgrounds     | 5.64     | 5.13     |
| `--color-leaf`            | `#3D5A3A` | Success, natural accents                       | 7.22     | 6.57     |
| `--color-indigo`          | `#2E3E5C` | Informational states                           | 10.03    | 9.13     |
| `--color-error`           | `#B42318` | Errors (always with an icon and text)          | 6.15     | 5.60     |
| `--color-warning`         | `#8A5300` | Warnings, low stock                            | 5.92     | 5.39     |
| `--color-border-strong`   | `#8C7862` | Form-control borders                           | 3.95     | 3.59     |

Fill combinations:

| Foreground on background | Ratio | Use                                  |
| ------------------------ | ----- | ------------------------------------ |
| Ivory on sindoor         | 7.04  | Primary button                       |
| Ivory on sindoor-deep    | 9.55  | Primary button hover                 |
| Ivory on ink             | 15.98 | Footer, dark editorial panels        |
| Gold on ink              | 5.47  | Ornament and headings on dark panels |
| Ivory on terracotta      | 4.47  | **Not for button text** (below 4.5)  |

### Dark (ink) surfaces

Sections with `data-surface="ink"` remap the semantic tokens, so components need no dark-mode variants:

| Semantic token     | Value on ink | Ratio on ink    |
| ------------------ | ------------ | --------------- |
| `--text`           | ivory        | 15.98           |
| `--text-secondary` | sand         | 12.36           |
| `--text-muted`     | `#BFAE96`    | 7.89            |
| `--control-border` | `#8C7862`    | 4.05            |
| `--ornament`       | gold         | 5.47            |
| `--rule`           | `#4A3C33`    | decorative only |
| `--focus`          | ivory        | 15.98           |

### Usage rules

- Gold and terracotta are never small text on light backgrounds. Use `--color-gold-text` or `--color-terracotta-text` instead.
- Form-control borders use `--color-border-strong`, which meets the 3:1 non-text contrast requirement (1.4.11). `--color-sand` is decorative only.
- The error red and the brand red are deliberately close in hue, so colour is never the only signal. Errors, stock and payment states always carry text, and an icon where space allows.
- Large areas of saturated red are avoided. Red is an accent, not a background.

---

## 3. Typography

| Role               | Family                 | Weights                                 | Where                                                                                                                                                                |
| ------------------ | ---------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display / headings | **Cormorant Garamond** | 500, 600 (+ italic 500 for pull quotes) | `h1`–`h3`, product titles, editorial quotes. Never below 20 px; its fine strokes break down at small sizes.                                                          |
| Text / UI          | **Mukta**              | 400, 500, 600                           | Body, navigation, forms, prices, admin. Designed by Ek Type (Mumbai). Covers Latin and Devanagari, so Hindi or Maithili lines can be set later without a third font. |

Both fonts load through `next/font/google`. They are downloaded at build time and served from our own domain, so there are no runtime requests to Google (better for privacy, CSP and performance).

### Type scale (fluid between 360 px and 1440 px viewports)

| Token         | Size                                     | Line height | Use                                                |
| ------------- | ---------------------------------------- | ----------- | -------------------------------------------------- |
| `--text-xs`   | 0.75 rem (12 px)                         | 1.5         | Legal fine print only; never essential information |
| `--text-sm`   | 0.875 rem (14 px)                        | 1.55        | Metadata, captions, helper text                    |
| `--text-base` | 1 rem (16 px)                            | 1.6         | Body                                               |
| `--text-lg`   | 1.125 rem (18 px)                        | 1.55        | Lead paragraphs, product price                     |
| `--text-xl`   | 1.375 rem (22 px)                        | 1.3         | `h4`, card titles (serif)                          |
| `--text-2xl`  | `clamp(1.625rem, 1.35rem + 1.2vw, 2rem)` | 1.2         | `h3`                                               |
| `--text-3xl`  | `clamp(2rem, 1.55rem + 2vw, 2.75rem)`    | 1.15        | `h2` (section headings)                            |
| `--text-4xl`  | `clamp(2.5rem, 1.7rem + 3.6vw, 4rem)`    | 1.08        | `h1` / hero                                        |

- Body measure is capped at about 68 characters. Headings use `text-wrap: balance`.
- **Eyebrow labels:** Mukta 500, 0.8125 rem, uppercase, 0.12 em tracking. At most one per section.
- No all-caps body text and no justified text.

---

## 4. Space, layout and breakpoints

- **Spacing scale (4 px base):** `--space-1` 4 · `--space-2` 8 · `--space-3` 12 · `--space-4` 16 · `--space-5` 24 · `--space-6` 32 · `--space-7` 48 · `--space-8` 64 · `--space-9` 96 · `--space-10` 128.
- **Section rhythm:** block padding `clamp(3.5rem, 8vw, 7.5rem)`.
- **Container:** content max width 80 rem (1280 px), with fluid gutters `clamp(1rem, 4vw, 2.5rem)`. Editorial imagery may go full-bleed.
- **Grid:** 4 columns on mobile, 8 on tablet, 12 on desktop. Gap `clamp(1rem, 2vw, 1.5rem)`.
- **Breakpoints:** mobile-first `min-width`, written in `em` so they respond to user zoom.

| Name  | Width           | Typical devices                  |
| ----- | --------------- | -------------------------------- |
| base  | < 30 em         | Small phones (320–479 px)        |
| `sm`  | 30 em (480 px)  | Large phones                     |
| `md`  | 48 em (768 px)  | Tablets portrait                 |
| `lg`  | 64 em (1024 px) | Tablets landscape, small laptops |
| `xl`  | 80 em (1280 px) | Laptops, desktops                |
| `2xl` | 96 em (1536 px) | Large desktops                   |

Container queries are used where a component's layout depends on its own width (product cards, editorial blocks) rather than the viewport's.

---

## 5. Shape, borders and elevation

| Token               | Value                        | Use                                                          |
| ------------------- | ---------------------------- | ------------------------------------------------------------ |
| `--radius-0`        | 0                            | Images, panels, sections                                     |
| `--radius-1`        | 2 px                         | Buttons, inputs, selects                                     |
| `--radius-round`    | 50 %                         | Colour swatches and avatars only                             |
| `--border-hairline` | 1 px `--color-sand`          | Section and list dividers                                    |
| `--border-control`  | 1 px `--color-border-strong` | Inputs, selects, secondary buttons                           |
| `--shadow-overlay`  | soft, low-spread             | Dialogs, drawers and menus only; nothing else casts a shadow |

---

## 6. Motion

| Token             | Value                        |
| ----------------- | ---------------------------- |
| `--duration-fast` | 120 ms (hover, focus)        |
| `--duration-base` | 200 ms (menus, disclosures)  |
| `--duration-slow` | 320 ms (drawers, dialogs)    |
| `--ease-out`      | `cubic-bezier(0.2, 0, 0, 1)` |

- Only `opacity` and `transform` are animated.
- Under `prefers-reduced-motion: reduce`, durations collapse to near zero and nothing slides.
- No parallax, no scroll-triggered reveals, and no auto-rotating carousels.

---

## 7. Ornament

| Component      | Description                                                                                       | Use                                              |
| -------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `MotifDivider` | Double rule enclosing a band of _kachni_ diagonal hatching, gold on ivory.                        | At most one per section transition.              |
| `FramedPanel`  | Madhubani-style double border with an inner hatched margin around an image.                       | Heritage and editorial imagery.                  |
| Artist motifs  | Fish, peacock, lotus and other figurative work, vectorised from the brand's own commissioned art. | Accent illustrations, empty states. Requires D2. |

All ornament is decorative (`aria-hidden="true"`) and built as inline SVG or CSS. Nothing ornamental is a raster image.

---

## 8. Phase 1 components

| Component                                                       | Notes                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Button` / `ButtonLink`                                         | Variants: **primary** (ivory on sindoor), **secondary** (ink text with control border), **quiet** (text with underline). Minimum height 44 px, radius 2 px, Mukta 500. `aria-busy` while pending; a disabled state never hides the reason it is disabled.                                  |
| Links                                                           | Underlined in body copy (`text-underline-offset: 0.2em`). Navigation links underline on hover and focus.                                                                                                                                                                                   |
| Focus ring                                                      | `outline: 2px solid var(--color-focus)` with a 3 px offset. Focus colour is ink on light surfaces and ivory on dark ones. Never removed.                                                                                                                                                   |
| `SkipLink`, `VisuallyHidden`, `Container`, `Section`, `Eyebrow` | Structural primitives.                                                                                                                                                                                                                                                                     |
| `Icon`                                                          | Wraps `lucide-react` at stroke 1.5 and 20/24 px. `aria-hidden` unless the icon is the only content of a control, in which case the control has an accessible name.                                                                                                                         |
| `AnnouncementBar`                                               | One line of real, current information (a shipping policy or offer that actually exists). Not dismissible-then-reappearing, not a marquee.                                                                                                                                                  |
| `Header`                                                        | **Desktop:** search (left), wordmark (centre), account, wishlist and cart (right), with the category navigation row beneath; utilities appear as their features ship. **Mobile:** menu button, centred wordmark, cart. The compact row is sticky using CSS only, with no scroll listeners. |
| `DesktopNav`                                                    | Disclosure pattern: each top-level category is a button that reveals its sub-categories, with Escape to close and focus returned to the trigger.                                                                                                                                           |
| `MobileNav`                                                     | Native `<dialog>` opened with `showModal()`, which gives background inertness, Escape to close and focus restore. Categories expand as nested disclosures.                                                                                                                                 |
| `Footer`                                                        | Ink background. Brand statement, category and help links, policy links, real contact details and social handles, and legal business details.                                                                                                                                               |

---

## 9. CSS implementation

- **Global files:** `src/styles/reset.css`, `tokens.css` and `globals.css`, declared in order as `@layer reset, tokens, base`.
- **Component styles** live in CSS Modules outside those layers, so they always override base styles without specificity battles.
- **Modules use tokens only.** No raw hex values and no unexplained magic numbers. Exceptions get a comment.
- **Layout:** logical properties throughout (`margin-inline`, `padding-block`).
- **Scrolling:** `scroll-padding-top` is set to the sticky header's height. `scroll-behavior: smooth` applies to in-page scrolling only: the root `<html>` carries `data-scroll-behavior="smooth"`, which Next.js 16 needs to scroll a navigation to the top instantly (without it the new page slides up from the old scroll position under the sticky header).
- **No utility-class framework.** Global utilities are limited to `.visually-hidden` and the container.
