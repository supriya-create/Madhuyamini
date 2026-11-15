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

/**
 * Audit batch 3 (B-05): nothing a visitor can see leads to a 404. Every
 * anchor on the main storefront pages must resolve (a redirect to sign in
 * counts), and none may point at a route that is still pending.
 */
test("no visible storefront link leads to a 404, and none points at a pending route", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The links are the same in every project",
  );
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const pages = [
    "/",
    "/collections",
    "/collections/clothing",
    "/products/sample-fish-tote-bag",
    "/cart",
    "/login",
    "/register",
    "/orders/track",
  ];
  const seen = new Set<string>();
  for (const path of pages) {
    await page.goto(path);
    const origin = new URL(page.url()).origin;
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].map(
        (a) => a.href,
      ),
    );
    for (const href of hrefs) {
      const url = new URL(href);
      if (url.origin !== origin || seen.has(url.pathname)) continue;
      seen.add(url.pathname);
      expect(
        pendingPhaseFor(url.pathname),
        `${url.pathname} (on ${path}) is a pending route and must not be linked yet`,
      ).toBeUndefined();
      const response = await request.get(url.pathname, { maxRedirects: 0 });
      expect(
        [200, 302, 303, 307, 308],
        `${url.pathname} (on ${path}) should resolve`,
      ).toContain(response.status());
    }
  }
  expect(seen.size).toBeGreaterThan(10);
  expect(
    consoleErrors.filter((text) => text.includes("404")),
    "no page should trigger a 404 in the console",
  ).toEqual([]);
});
