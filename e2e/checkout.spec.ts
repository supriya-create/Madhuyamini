import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { FAKE_WEBHOOK_SECRET } from "../src/server/payments/fake-secrets";
import { waitForEmail } from "../tests/support/mailbox";
import { fakeAddress, register, signIn, uniqueEmail } from "./accounts";
import { expectNoAxeViolations } from "./support";

/**
 * Checkout and order journeys against the production build with the fake
 * payment gateway (PAYMENT_GATEWAY=fake, set in playwright.config.ts). The
 * pay page's simulator buttons run the same confirmation path Razorpay's
 * callback would; webhooks are posted to the real route with the fake secret.
 */

const MAIL_DIR =
  process.env.E2E_MAIL_DIR ??
  mkdtempSync(join(tmpdir(), "madhuyamini-e2e-mail-"));
const CRON_SECRET = "e2e-cron-secret-value";
const TOTE = "/products/sample-fish-tote-bag"; // ₹1,299, deep stock for these journeys

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": fakeAddress() });
});

async function addTote(page: Page, quantity = 1) {
  await page.goto(TOTE);
  if (quantity > 1) {
    await page
      .getByLabel("Quantity", { exact: true })
      .selectOption(String(quantity));
  }
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByRole("status")).toContainText("Added to your cart");
}

async function fillAddress(page: Page) {
  await page.getByLabel("Recipient’s name").fill("Asha Devi");
  await page.getByLabel("Address", { exact: true }).fill("12 Station Road");
  await page.getByLabel("City").fill("Madhubani");
  await page.getByLabel("State").fill("Bihar");
  await page.getByLabel("PIN code").fill("847211");
}

async function runJob(page: Page, job: string) {
  const response = await page.request.get(`/api/cron/${job}`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as Record<string, number | string>;
}

function orderNumberFrom(text: string | null): string {
  const match = /MY-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}/.exec(text ?? "");
  if (!match) throw new Error(`no order number in: ${text ?? ""}`);
  return match[0];
}

test.describe("guest checkout", () => {
  test("places a cash-on-delivery order, confirms it, emails, and tracks it later", async ({
    page,
    browser,
  }, testInfo) => {
    const email = uniqueEmail("cod", testInfo);
    await addTote(page);
    await page.goto("/cart");
    await page.getByRole("link", { name: "Proceed to checkout" }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Checkout",
    );
    await expect(page.getByText("Subtotal")).toBeVisible();
    await expect(page.getByText("₹1,398")).toHaveCount(3); // online, COD, summary total
    await expectNoAxeViolations(page, "checkout");

    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Phone number").fill("9876543210");
    await fillAddress(page);
    await page.getByLabel(/Cash on delivery/).check();
    await page.getByRole("button", { name: "Place order" }).click();

    await expect(page).toHaveURL(
      /\/checkout\/confirmation\/[0-9a-f-]+\?placed=1$/,
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Thank you",
    );
    await expect(page.getByRole("status").first()).toContainText(
      "is confirmed",
    );
    const orderNumber = orderNumberFrom(
      await page.getByRole("heading", { level: 2, name: /MY-/ }).textContent(),
    );
    await expect(page.getByText("Cash on delivery")).toBeVisible();
    await expect(page.getByText("12 Station Road")).toBeVisible();
    await expect(page.getByText("₹1,398").first()).toBeVisible();
    // A fresh navigation: Chromium restores the scroll position on reload,
    // which parks the sticky header over the buttons the audit measures.
    await page.goto(page.url());
    await expectNoAxeViolations(page, "confirmation");

    // The cart was converted; the header count is back to zero.
    await page.goto("/cart");
    await expect(page.getByText("Your cart is empty")).toBeVisible();

    // Emails leave through the outbox job.
    await runJob(page, "send-notifications");
    const mail = await waitForEmail(MAIL_DIR, email, /confirmed/i);
    expect(mail.subject).toContain(orderNumber);

    // Tracking from a fresh browser with number + email, then the wrong email.
    const fresh = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": fakeAddress() },
    });
    const other = await fresh.newPage();
    await other.goto("/orders/track");
    await expectNoAxeViolations(other, "track order");
    await other.getByLabel("Order number").fill(orderNumber.toLowerCase());
    await other.getByLabel("Email address used for the order").fill(email);
    await other.getByRole("button", { name: "Find my order" }).click();
    await expect(other).toHaveURL(/\/checkout\/confirmation\//);
    await expect(
      other.getByRole("heading", { level: 2, name: orderNumber }),
    ).toBeVisible();

    await other.goto("/orders/track");
    await other.getByLabel("Order number").fill(orderNumber);
    await other
      .getByLabel("Email address used for the order")
      .fill(uniqueEmail("nobody", testInfo)); // unique: lookups are limited per email
    await other.getByRole("button", { name: "Find my order" }).click();
    await expect(other.locator("form").getByRole("alert")).toContainText(
      "could not find an order",
    );
    await fresh.close();
  });

  test("the confirmation page is private: a stranger is sent to tracking", async ({
    page,
    browser,
  }, testInfo) => {
    await addTote(page);
    await page.goto("/checkout");
    await page
      .getByLabel("Email address")
      .fill(uniqueEmail("private", testInfo));
    await page.getByLabel("Phone number").fill("9876543210");
    await fillAddress(page);
    await page.getByLabel(/Cash on delivery/).check();
    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page).toHaveURL(/\/checkout\/confirmation\//);
    const url = page.url();

    const stranger = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": fakeAddress() },
    });
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(url);
    await expect(strangerPage).toHaveURL(/\/orders\/track$/);
    await stranger.close();
  });

  test("an empty cart cannot reach checkout", async ({ page }) => {
    await page.goto("/checkout");
    await expect(page).toHaveURL(/\/cart$/);
  });
});

test.describe("online payment", () => {
  async function placeOnlineOrder(page: Page, email: string) {
    await register(page, email);
    await signIn(page, email);
    await addTote(page, 2); // ₹2,598: free shipping
    await page.goto("/checkout");
    await expect(page.getByText(email)).toBeVisible(); // contact email is fixed
    await page.getByLabel("Phone number").fill("9876543210");
    await fillAddress(page);
    await page.getByLabel("Save this address to my account").check();
    await expect(page.getByLabel(/Pay online/)).toBeChecked();
    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page).toHaveURL(/\/checkout\/pay\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Pay for order",
    );
    await expect(page.getByText("₹2,598")).toBeVisible();
  }

  test("succeeds through the gateway callback and shows up in the account", async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail("pay", testInfo);
    await placeOnlineOrder(page, email);
    await expect(page.getByRole("button", { name: "Pay now" })).toBeVisible();
    await expectNoAxeViolations(page, "pay");

    await page
      .getByRole("button", { name: "Simulate successful payment" })
      .click();
    await expect(page).toHaveURL(/\/checkout\/confirmation\/.*placed=1$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Thank you",
    );
    const orderNumber = orderNumberFrom(
      await page.getByRole("heading", { level: 2, name: /MY-/ }).textContent(),
    );
    await expect(page.getByText("Paid online")).toBeVisible();
    await expect(
      page.getByText("Payment received", { exact: true }),
    ).toBeVisible();

    await page.goto("/account/orders");
    await expect(page.getByRole("link", { name: orderNumber })).toBeVisible();
    await expect(page.getByText("Confirmed")).toBeVisible();
    await expectNoAxeViolations(page, "orders");
    await page.getByRole("link", { name: orderNumber }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      `Order ${orderNumber}`,
    );
    await expect(page.getByText("Order placed")).toBeVisible();
    await expectNoAxeViolations(page, "order detail");

    // The address was saved to the account.
    await page.goto("/account/addresses");
    await expect(page.getByText("12 Station Road")).toBeVisible();
  });

  test("a failed payment can be retried, and the order can be cancelled", async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail("retry", testInfo);
    await placeOnlineOrder(page, email);
    await page.getByRole("button", { name: "Simulate failed payment" }).click();
    await expect(page).toHaveURL(/\/checkout\/pay\/.*failed=1$/);
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "did not go through",
    );
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("button", { name: "Pay now" })).toBeVisible();

    await page.getByRole("button", { name: "Cancel this order" }).click();
    await expect(page).toHaveURL(/\/cart\?order=cancelled$/);
    await expect(page.getByRole("status")).toContainText(
      "nothing has been charged",
    );
    // The cart survived the cancellation.
    await expect(page.getByText("Subtotal (2 items)")).toBeVisible();

    await page.goto("/account/orders");
    await expect(page.getByText("Cancelled")).toBeVisible();
  });

  test("a capture delivered only by webhook still confirms the order", async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail("webhook", testInfo);
    await placeOnlineOrder(page, email);
    await page
      .getByRole("button", { name: "Simulate payment with no callback" })
      .click();
    await expect(page).toHaveURL(/simulated=/);
    const url = new URL(page.url());
    const providerPaymentId = url.searchParams.get("simulated")!;
    const providerOrderId = url.searchParams.get("providerOrder")!;
    const orderId = url.pathname.split("/").pop()!;

    const body = JSON.stringify({
      entity: "event",
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: providerPaymentId,
            order_id: providerOrderId,
            amount: 259_800,
            currency: "INR",
            status: "captured",
          },
        },
      },
    });
    const signature = createHmac("sha256", FAKE_WEBHOOK_SECRET)
      .update(body)
      .digest("hex");
    const delivered = await page.request.post("/api/webhooks/razorpay", {
      data: body,
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signature,
        "x-razorpay-event-id": `evt_e2e_${Date.now()}`,
      },
    });
    expect(delivered.status()).toBe(200);
    expect(await delivered.json()).toMatchObject({
      ok: true,
      applied: "processed",
    });

    // A tampered delivery is refused.
    const refused = await page.request.post("/api/webhooks/razorpay", {
      data: body,
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signature.replace(/^./, (c) =>
          c === "0" ? "1" : "0",
        ),
      },
    });
    expect(refused.status()).toBe(401);

    await page.goto(`/checkout/confirmation/${orderId}`);
    await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Payment received", { exact: true }),
    ).toBeVisible();
  });

  test("works without JavaScript: the server-rendered form posts and redirects", async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail("nojs", testInfo);
    await addTote(page);
    const html = await (await page.request.get("/checkout")).text();
    const form = html.match(
      /<form[^>]*>(?:(?!<\/form>)[\s\S])*?Place order[\s\S]*?<\/form>/,
    )?.[0];
    if (!form) throw new Error("checkout form not found in the server HTML");
    const fields: Record<string, string> = {};
    for (const input of form.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
      const name = /name="([^"]*)"/.exec(input[0])?.[1];
      const value = /value="([^"]*)"/.exec(input[0])?.[1] ?? "";
      if (name)
        fields[name] = value
          .replace(/&quot;/g, '"')
          .replace(/&#x27;/g, "'")
          .replace(/&amp;/g, "&");
    }
    const response = await page.request.post("/checkout", {
      multipart: {
        ...fields,
        email,
        phone: "9876543210",
        paymentMethod: "COD",
        recipientName: "Asha Devi",
        line1: "12 Station Road",
        city: "Madhubani",
        state: "Bihar",
        postalCode: "847211",
      },
      maxRedirects: 0,
    });
    expect([303, 302]).toContain(response.status());
    expect(response.headers().location).toMatch(/\/checkout\/confirmation\//);
  });
});

test.describe("cron routes", () => {
  test("refuse without the secret and answer with it", async ({ page }) => {
    expect((await page.request.get("/api/cron/cleanup")).status()).toBe(401);
    const summary = await runJob(page, "cleanup");
    expect(summary.job).toBe("cleanup");
  });
});
