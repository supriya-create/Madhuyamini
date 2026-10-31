import { expect, test } from "@playwright/test";

import { expectNoAxeViolations, isMobileProject } from "./support";

/**
 * Catalog journeys against the seeded development fixtures (prisma/seed).
 * The e2e server runs on the development database, which CI seeds first.
 */

test.describe("collections", () => {
  test("index lists every top-level category with its children", async ({
    page,
  }) => {
    await page.goto("/collections");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Collections",
    );
    for (const name of ["Clothing", "Wall Art", "Home Décor", "Accessories"]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Sarees" })).toHaveAttribute(
      "href",
      "/collections/sarees",
    );
  });

  test("a parent category lists products from its children and offers them as chips", async ({
    page,
  }) => {
    await page.goto("/collections/clothing");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Clothing",
    );
    await expect(
      page.getByRole("navigation", { name: "Browse Clothing" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: /3 products/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Peacock kurta set" }),
    ).toBeVisible();
  });

  test("breadcrumbs lead back through the parent category", async ({
    page,
  }) => {
    await page.goto("/collections/sarees");
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(
      crumbs.getByRole("link", { name: "Clothing" }),
    ).toHaveAttribute("href", "/collections/clothing");
    await expect(crumbs.getByText("Sarees")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("hidden products never appear and unknown slugs are 404s", async ({
    page,
  }) => {
    await page.goto("/collections/wall-hangings");
    await expect(
      page.getByRole("heading", { name: "Nothing here yet" }),
    ).toBeVisible();
    await expect(page.getByText("Draft wall hanging")).toHaveCount(0);

    const response = await page.goto("/collections/no-such-collection");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "We couldn’t find that page",
    );
  });
});

test.describe("filtering, sorting and pagination", () => {
  test("filters work as a plain GET form and produce shareable URLs", async ({
    page,
  }, testInfo) => {
    await page.goto("/collections/clothing");
    if (isMobileProject(testInfo)) {
      await page.getByText("Filters", { exact: true }).click();
    }
    await page.getByLabel("Hand-painted").check();
    await page.getByRole("button", { name: "Apply" }).click();

    await expect(page).toHaveURL(
      /\/collections\/clothing\?technique=HAND_PAINTED/,
    );
    await expect(
      page.getByRole("heading", { level: 2, name: /2 products/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Peacock kurta set" }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Hand-painted")).toBeChecked();

    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/collections\/clothing$/);
  });

  test("an impossible price range shows the empty state with a way out", async ({
    page,
  }) => {
    await page.goto("/collections/clothing?minPrice=90000");
    await expect(
      page.getByRole("heading", { name: "Nothing matches those filters" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).first().click();
    await expect(
      page.getByRole("heading", { level: 2, name: /3 products/ }),
    ).toBeVisible();
  });

  test("sorting by price orders the grid", async ({ page }) => {
    await page.goto("/collections/clothing?sort=price-desc");
    const titles = await page.locator("article h3").allTextContents();
    expect(titles).toEqual([
      "Fish motif tussar silk saree",
      "Peacock kurta set",
      "Lotus dupatta",
    ]);
  });

  test("pagination links keep the active filters", async ({ page }) => {
    await page.goto("/search?q=sample&pageSize=3&sort=title");
    const pagination = page.getByRole("navigation", { name: "Pagination" });
    await expect(pagination).toBeVisible();
    await expect(pagination.getByText("Page 1")).toHaveAttribute(
      "aria-current",
      "page",
    );

    await pagination.getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(/q=sample.*page=2|page=2.*q=sample/);
    await expect(pagination.getByText("Page 2")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      page.getByRole("heading", { level: 2, name: /7 products · showing 4–6/ }),
    ).toBeVisible();
  });

  test("junk query parameters never break a listing", async ({ page }) => {
    const response = await page.goto(
      "/collections/clothing?utm_source=newsletter&fbclid=abc",
    );
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 2, name: /3 products/ }),
    ).toBeVisible();

    await page.goto("/collections/clothing?page=abc&sort=cheapest");
    await expect(page).toHaveURL(/\/collections\/clothing$/);
  });
});

test.describe("search", () => {
  test("the header search lands on results", async ({ page }, testInfo) => {
    await page.goto("/");
    if (isMobileProject(testInfo)) {
      await page.getByRole("button", { name: "Menu" }).click();
      await page
        .getByRole("dialog", { name: "Menu" })
        .getByRole("searchbox")
        .fill("fish");
      await page
        .getByRole("dialog", { name: "Menu" })
        .getByRole("searchbox")
        .press("Enter");
    } else {
      await page.getByRole("banner").getByRole("searchbox").fill("fish");
      await page.getByRole("banner").getByRole("searchbox").press("Enter");
    }
    await expect(page).toHaveURL(/\/search\?q=fish$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Results for “fish”",
    );
    await expect(
      page.getByRole("heading", { level: 2, name: /2 products/ }),
    ).toBeVisible();
  });

  test("no results and empty searches are handled", async ({ page }) => {
    await page.goto("/search?q=zebra");
    await expect(
      page.getByRole("heading", { name: "No results for “zebra”" }),
    ).toBeVisible();

    await page.goto("/search");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Search");
    await expect(
      page.getByRole("heading", { name: "Start with a word or two" }),
    ).toBeVisible();
  });
});

test.describe("product page", () => {
  test("shows the piece, how it is made, and related products", async ({
    page,
  }) => {
    await page.goto("/products/sample-tree-of-life-canvas-print");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Tree of life canvas print",
    );
    await expect(
      page.getByRole("img", {
        name: "Tree of life canvas print: no photograph yet",
      }),
    ).toBeVisible();
    await expect(page.getByText("Stretched canvas, Framed")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "You may also like" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Kohbar, original painting" }),
    ).toBeVisible();
  });

  test("choosing options updates price, availability and SKU", async ({
    page,
  }) => {
    await page.goto("/products/sample-peacock-kurta-set");
    const outcome = page.locator("[aria-live=polite][aria-atomic=true]");
    await expect(outcome).toContainText("MY-SAMPLE-0002-S");

    await page.getByRole("radio", { name: "XL" }).check();
    await expect(outcome).toContainText("Only 1 left");
    await expect(outcome).toContainText("MY-SAMPLE-0002-XL");

    await page.getByRole("radio", { name: /XS/ }).check();
    await expect(outcome).toContainText("Sold out");
  });

  test("two option axes resolve to the right variant", async ({ page }) => {
    await page.goto("/products/sample-tree-of-life-canvas-print");
    const outcome = page.locator("[aria-live=polite][aria-atomic=true]");
    await page.getByRole("radio", { name: "18 × 24 in" }).check();
    await page.getByRole("radio", { name: "Framed", exact: true }).check();
    await expect(outcome).toContainText("₹5,499");
    await expect(outcome).toContainText("Sold out");
  });

  test("a one-of-a-kind original says so", async ({ page }) => {
    await page.goto("/products/sample-kohbar-original");
    await expect(
      page.getByText("One of a kind: a single original, sold once."),
    ).toBeVisible();
    await expect(page.getByText("One of a kind, available")).toBeVisible();
  });

  test("draft, archived and unknown products are 404s", async ({ page }) => {
    for (const slug of [
      "sample-draft-wall-hanging",
      "sample-archived-notebook",
      "nope",
    ]) {
      const response = await page.goto(`/products/${slug}`);
      expect(response?.status(), slug).toBe(404);
    }
  });
});

test.describe("navigation and homepage come from the database", () => {
  test("the header lists the seeded categories", async ({ page }, testInfo) => {
    await page.goto("/");
    if (isMobileProject(testInfo)) {
      await page.getByRole("button", { name: "Menu" }).click();
      await page
        .getByRole("dialog", { name: "Menu" })
        .getByText("Home Décor", { exact: true })
        .click();
      await expect(
        page
          .getByRole("dialog", { name: "Menu" })
          .getByRole("link", { name: "Cushion covers" }),
      ).toBeVisible();
    } else {
      await page.getByRole("button", { name: "Home Décor" }).click();
      await expect(
        page
          .getByRole("navigation", { name: "Main" })
          .getByRole("link", { name: "Cushion covers" }),
      ).toBeVisible();
    }
  });

  test("the homepage shows collections and featured pieces", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Shop by collection" }),
    ).toBeVisible();
    const featured = page.getByRole("region", { name: "Featured pieces" });
    await expect(featured).toBeVisible();
    await expect(featured.locator("article")).toHaveCount(4);
    await expect(featured.getByText("Draft wall hanging")).toHaveCount(0);
  });
});

test.describe("accessibility of catalog pages", () => {
  for (const path of [
    "/collections",
    "/collections/clothing?technique=HAND_PAINTED",
    "/products/sample-peacock-kurta-set",
    "/search?q=fish",
    "/search?q=zebra",
  ]) {
    test(`axe: ${path}`, async ({ page }) => {
      await page.goto(path);
      await expectNoAxeViolations(page, path);
    });
  }
});
