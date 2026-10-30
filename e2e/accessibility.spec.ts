import { expect, test } from "@playwright/test";

import { expectNoAxeViolations, isMobileProject } from "./support";

test.describe("automated accessibility checks (axe, WCAG 2.2 A/AA)", () => {
  test("homepage", async ({ page }) => {
    await page.goto("/");
    await expectNoAxeViolations(page, "homepage");
  });

  test("homepage with navigation open", async ({ page }, testInfo) => {
    await page.goto("/");
    if (isMobileProject(testInfo)) {
      await page.getByRole("button", { name: "Menu" }).click();
      await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
    } else {
      await page.getByRole("button", { name: "Clothing" }).click();
      await expect(page.locator("#nav-panel-clothing")).toBeVisible();
    }
    await expectNoAxeViolations(page, "navigation open");
  });

  test("404 page", async ({ page }) => {
    await page.goto("/missing-page");
    await expectNoAxeViolations(page, "404");
  });

  test("design system specimen", async ({ page }) => {
    await page.goto("/design-system");
    await expectNoAxeViolations(page, "design system");
  });
});

test.describe("responsive layout", () => {
  test("no horizontal scrolling at 320px wide", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/");

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("interactive targets are at least 24×24px (WCAG 2.5.8)", async ({
    page,
  }) => {
    await page.goto("/");

    const undersized = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("a[href], button, summary")]
        .filter((element) => element.getClientRects().length > 0)
        .filter((element) => !element.closest("p"))
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width < 24 || rect.height < 24)
        .map(({ element }) => element.outerHTML.slice(0, 80)),
    );
    expect(undersized).toEqual([]);
  });
});

test.describe("reduced motion", () => {
  test.use({ colorScheme: "light" });

  test("transitions are effectively disabled when the user prefers reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    const duration = await page
      .getByRole("link", { name: "Explore the collections" })
      .evaluate((element) => getComputedStyle(element).transitionDuration);
    for (const value of duration.split(",")) {
      expect(Number.parseFloat(value)).toBeLessThan(0.001);
    }
  });
});
