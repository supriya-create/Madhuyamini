import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { fakeAddress, register, signIn, uniqueEmail } from "./accounts";
import { expectNoAxeViolations } from "./support";

/**
 * Cart and wishlist journeys against the production build and the seeded
 * development catalog. Each browser context is its own guest, so the
 * projects can run in parallel without sharing carts.
 */

const DUPATTA = "/products/sample-lotus-dupatta"; // single variant, stock 5
const ORIGINAL = "/products/sample-kohbar-original"; // one of a kind

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": fakeAddress() });
});

/** The add-to-cart form's own live region (the route announcer is also an alert). */
function addToCartOutcome(page: Page) {
  return page
    .locator("form", { has: page.getByRole("button", { name: "Add to cart" }) })
    .getByRole("alert");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Hidden fields of the add-to-cart form as the server renders it (`$ACTION_*` + variantId). */
async function serverRenderedAddToCartFields(
  page: Page,
): Promise<Record<string, string>> {
  const html = await (await page.request.get(DUPATTA)).text();
  const form = html.match(
    /<form[^>]*>(?:(?!<\/form>)[\s\S])*?Add to cart[\s\S]*?<\/form>/,
  )?.[0];
  if (!form) throw new Error("add-to-cart form not found in the server HTML");
  const fields: Record<string, string> = {};
  for (const input of form.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(input[0])?.[1];
    const value = /value="([^"]*)"/.exec(input[0])?.[1] ?? "";
    if (name) fields[name] = decodeEntities(value);
  }
  return fields;
}

function cartLink(page: Page, count: number) {
  const label = `Cart, ${count} ${count === 1 ? "item" : "items"}`;
  return page.getByRole("banner").getByRole("link", { name: label });
}

async function addDupatta(page: Page, quantity = 1) {
  await page.goto(DUPATTA);
  if (quantity > 1) {
    await page
      .getByLabel("Quantity", { exact: true })
      .selectOption(String(quantity));
  }
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByRole("status")).toContainText("Added to your cart");
}

test.describe("guest cart", () => {
  test("adds from the product page, updates the header count and shows the cart", async ({
    page,
  }) => {
    await addDupatta(page, 2);
    await expect(cartLink(page, 2)).toBeVisible();

    await page.getByRole("link", { name: "View cart" }).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Your cart",
    );
    await expect(
      page.getByRole("link", { name: "Lotus dupatta", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Subtotal (2 items)")).toBeVisible();
    await expect(page.getByText("₹3,798")).toHaveCount(2); // line total + subtotal
    await expect(page.getByText("Calculated at checkout")).toBeVisible();
    await expect(page.getByRole("button", { name: /checkout/i })).toHaveCount(
      0,
    );
    await expectNoAxeViolations(page, "cart with items");
  });

  test("survives a reload and a fresh browser session with the same cookie", async ({
    page,
    browser,
  }) => {
    await addDupatta(page);
    await page.reload();
    await expect(cartLink(page, 1)).toBeVisible();

    // A new context with the persisted cookies stands in for reopening the browser.
    const restored = await browser.newContext({
      storageState: await page.context().storageState(),
    });
    const again = await restored.newPage();
    await again.goto("/cart");
    await expect(
      again.getByRole("link", { name: "Lotus dupatta", exact: true }),
    ).toBeVisible();
    await restored.close();

    // Without the cookie there is no cart at all.
    const stranger = await browser.newContext();
    const strangerPage = await stranger.newPage();
    await strangerPage.goto("/cart");
    await expect(strangerPage.getByText("Your cart is empty")).toBeVisible();
    await stranger.close();
  });

  test("changes quantity from the cart page and removes the line", async ({
    page,
  }) => {
    await addDupatta(page);
    await page.goto("/cart");
    await page.getByLabel("Quantity for Lotus dupatta").selectOption("3");
    await expect(page.getByText("Subtotal (3 items)")).toBeVisible();
    await expect(cartLink(page, 3)).toBeVisible();

    await page.getByRole("button", { name: /^Remove/ }).click();
    await expect(page.getByText("Your cart is empty")).toBeVisible();
    await expect(cartLink(page, 0)).toBeVisible();
    await expectNoAxeViolations(page, "empty cart");
  });

  test("a one-of-a-kind piece can be added once only", async ({ page }) => {
    await page.goto(ORIGINAL);
    await expect(page.getByLabel("Quantity", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Add to cart" }).click();
    await expect(page.getByRole("status")).toContainText("Added to your cart");

    await page.getByRole("button", { name: "Add to cart" }).click();
    await expect(addToCartOutcome(page)).toContainText("already in your cart");
    await expect(cartLink(page, 1)).toBeVisible();
  });

  test("tampered quantities are rejected on the server, and the form works without JavaScript", async ({
    page,
  }) => {
    // Post the server-rendered form directly (the no-JavaScript path), with a
    // quantity the select never offers. The server, not the select, decides.
    // The fields are read from the raw HTML: once hydrated, React removes them.
    const fields = await serverRenderedAddToCartFields(page);

    const tampered = await page.request.post(DUPATTA, {
      multipart: { ...fields, quantity: "99" },
    });
    expect(tampered.status()).toBe(200);
    expect(await tampered.text()).toContain("between 1 and 10");
    await page.goto("/cart");
    await expect(page.getByText("Your cart is empty")).toBeVisible();

    const valid = await page.request.post(DUPATTA, {
      multipart: { ...fields, quantity: "2" },
    });
    expect(valid.status()).toBe(200);
    expect(await valid.text()).toContain("Added to your cart");
    await page.goto("/cart");
    await expect(page.getByText("Subtotal (2 items)")).toBeVisible();
  });
});

test.describe("signing in with a guest cart", () => {
  test("merges the guest cart into the account and reports adjusted quantities", async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail("merge", testInfo);
    await register(page, email);
    await signIn(page, email);
    await addDupatta(page, 2);
    await page.goto("/account");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(cartLink(page, 0)).toBeVisible();

    // 2 in the account + 4 as a guest exceeds the 5 in stock, so the merge adjusts.
    await addDupatta(page, 4);
    await signIn(page, email);
    await expect(page).toHaveURL(/\/cart\?cart=adjusted$/);
    await expect(page.getByRole("status").first()).toContainText(
      "combined the cart you started as a guest",
    );
    await expect(page.getByLabel("Quantity for Lotus dupatta")).toHaveValue(
      "5",
    );
    await expect(cartLink(page, 5)).toBeVisible();

    // The guest cookie is gone: signing out leaves no cart behind.
    await page.goto("/account");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(cartLink(page, 0)).toBeVisible();
    await signIn(page, email);
    await expect(cartLink(page, 5)).toBeVisible();
  });
});

test.describe("wishlist", () => {
  test("asks guests to sign in, then saves and lists pieces for the account", async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail("wish", testInfo);
    await register(page, email);

    await page.goto(DUPATTA);
    await page.getByRole("button", { name: "Save to wishlist" }).click();
    await expect(page).toHaveURL(
      /\/login\?next=%2Fproducts%2Fsample-lotus-dupatta$/,
    );
    await page.getByLabel("Email address").fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("peacock on the pallu");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/products\/sample-lotus-dupatta$/);

    await page.getByRole("button", { name: "Save to wishlist" }).click();
    await expect(
      page.getByRole("button", { name: "Saved to wishlist" }),
    ).toHaveAttribute("aria-pressed", "true");

    await page.goto("/account/wishlist");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Wishlist",
    );
    await expect(
      page.getByRole("link", { name: /Lotus dupatta/ }),
    ).toBeVisible();
    await expectNoAxeViolations(page, "wishlist");

    await page.goto(DUPATTA);
    await page.getByRole("button", { name: "Saved to wishlist" }).click();
    await expect(
      page.getByRole("button", { name: "Save to wishlist" }),
    ).toHaveAttribute("aria-pressed", "false");
    await page.goto("/account/wishlist");
    await expect(page.getByText("Nothing saved yet")).toBeVisible();
  });

  test("the wishlist page is private", async ({ page }) => {
    await page.goto("/account/wishlist");
    await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Fwishlist/);
  });
});
