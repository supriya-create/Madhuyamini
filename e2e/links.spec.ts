import { expect, test } from "@playwright/test";

import { pendingPhaseFor } from "./pending-routes";

/**
 * Every internal link on the homepage must either work, or be an explicitly
 * tracked route from a later phase that still returns 404.
 */
test("internal links resolve or are tracked as pending", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Link audit runs once",
  );

  await page.goto("/");
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].map(
      (a) => a.href,
    ),
  );

  const origin = new URL(page.url()).origin;
  const internal = [...new Set(hrefs)]
    .map((href) => new URL(href))
    .filter((url) => url.origin === origin);
  expect(internal.length).toBeGreaterThan(0);

  for (const url of internal) {
    if (url.hash) {
      const target = url.hash.slice(1);
      await page.goto(url.pathname);
      await expect(
        page.locator(`[id="${target}"]`),
        `anchor ${url.href}`,
      ).toBeAttached();
    }

    const response = await request.get(url.pathname);
    const pendingPhase = pendingPhaseFor(url.pathname);
    if (pendingPhase === undefined) {
      expect(response.status(), `${url.pathname} should resolve`).toBe(200);
    } else {
      expect(
        response.status(),
        `${url.pathname} is listed as pending (Phase ${pendingPhase}) but now responds — remove it from e2e/pending-routes.ts`,
      ).toBe(404);
    }
  }
});
