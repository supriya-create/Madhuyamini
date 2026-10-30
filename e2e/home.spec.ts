import { expect, test } from "@playwright/test";

test.describe("homepage", () => {
  test("has a descriptive title, one h1 and the core landmarks", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/Madhuyamini/);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Madhubani, in every thread and frame",
    );
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en-IN");
  });

  test("renders each editorial section as a named region", async ({ page }) => {
    await page.goto("/");

    for (const name of [
      "Madhubani, in every thread and frame",
      "Old lines, new canvases",
      "A painted language from Mithila",
      "What every piece will tell you",
    ]) {
      await expect(page.getByRole("region", { name })).toBeVisible();
    }
    await expect(page.locator("#heritage")).toBeAttached();
  });

  test("shows no invented offers or contact details while they are unset", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("complementary", { name: "Announcement" }),
    ).toHaveCount(0);
    await expect(
      page.locator('a[href^="mailto:"], a[href^="tel:"]'),
    ).toHaveCount(0);
  });

  test("is not indexable outside production", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );

    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toMatch(/Disallow: \/\s*$/m);
  });

  test("sends baseline security headers", async ({ request }) => {
    const response = await request.get("/");
    const headers = response.headers();

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["x-powered-by"]).toBeUndefined();
  });
});

test.describe("error pages", () => {
  test("unknown URLs return a 404 page with site navigation", async ({
    page,
  }) => {
    const response = await page.goto("/this-page-does-not-exist");

    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "We couldn’t find that page",
    );
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to the homepage" }),
    ).toHaveAttribute("href", "/");
  });
});

test.describe("design system specimen", () => {
  test("is available outside production and is not indexable", async ({
    page,
  }) => {
    const response = await page.goto("/design-system");

    expect(response?.status()).toBe(200);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await expect(page.getByText("₹1,49,999")).toBeVisible();
  });
});
