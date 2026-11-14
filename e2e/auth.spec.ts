import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { firstLink, waitForEmail } from "../tests/support/mailbox";
import { uniqueEmail } from "./accounts";
import { expectNoAxeViolations, isMobileProject, tabKey } from "./support";

/**
 * Account journeys against the production build. Emails are captured by the
 * file transport in E2E_MAIL_DIR (see playwright.config.ts).
 */

const MAIL_DIR =
  process.env.E2E_MAIL_DIR ??
  mkdtempSync(join(tmpdir(), "madhuyamini-e2e-mail-"));
const PASSWORD = "peacock on the pallu";

/** A distinct client address per test, so the per-IP limits apply to each test alone. */
function fakeAddress(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": fakeAddress() });
});

async function register(page: Page, email: string, name = "Asha Devi") {
  await page.goto("/register");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText(
    "sent a confirmation link",
  );
}

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Wait for the action to finish: either we left /login or an error is shown.
  await Promise.race([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 15_000,
    }),
    page.locator("form").getByRole("alert").waitFor({ timeout: 15_000 }),
  ]);
}

test.describe("registration and verification", () => {
  test("creates an account, confirms the email from the link, and signs in", async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail("asha", testInfo);
    await register(page, email);

    const mail = await waitForEmail(MAIL_DIR, email, /confirm your email/i);
    await page.goto(firstLink(mail));
    await expect(page).toHaveURL(/\/login\?verified=1$/);
    await expect(page.getByRole("status")).toContainText(
      "Your email address is confirmed",
    );

    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Overview",
    );
    await expect(page.getByText("Send the link again")).toHaveCount(0);
  });

  test("shows the same success screen for an email that is already registered", async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail("dupe", testInfo);
    await register(page, email);
    const before = (await waitForEmail(MAIL_DIR, email, /confirm/i)).sentAt;

    await register(page, email, "Impostor");
    // Identical outcome, and no second email to the real owner.
    const after = await waitForEmail(MAIL_DIR, email, /confirm/i);
    expect(after.sentAt).toBe(before);
  });

  test("rejects a predictable password with a field error", async ({
    page,
  }, testInfo) => {
    await page.goto("/register");
    await page.getByLabel("Your name").fill("Asha Devi");
    await page.getByLabel("Email address").fill(uniqueEmail("weak", testInfo));
    await page.getByLabel("Password", { exact: true }).fill("password1234");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.locator("form").getByRole("alert").first()).toContainText(
      "too predictable",
    );
  });
});

test.describe("sign in and sign out", () => {
  test("a wrong password gets the generic message, and the account area stays closed", async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail("wrong", testInfo);
    await register(page, email);
    await signIn(page, email, "not the password");
    await expect(page.locator("form").getByRole("alert")).toContainText(
      "not correct",
    );
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/account");
    await expect(page).toHaveURL(/\/login\?next=%2Faccount/);
  });

  test("returns to the requested page after signing in and signs out cleanly", async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail("return", testInfo);
    await register(page, email);
    await page.goto("/account/addresses");
    await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Faddresses/);
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/account\/addresses$/);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login/);
  });

  test("the header reflects the signed-in state", async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail("header", testInfo);
    await register(page, email);
    await page.goto("/");
    await expect(
      page.getByRole("banner").getByRole("link", { name: "Sign in" }),
    ).toBeVisible();
    await signIn(page, email);
    await page.goto("/");
    await expect(
      page.getByRole("banner").getByRole("link", { name: "Your account" }),
    ).toBeVisible();
  });
});

test.describe("password reset", () => {
  test("resets through the emailed link and the old password stops working", async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail("reset", testInfo);
    await register(page, email);

    await page.goto("/forgot-password");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText(
      "If an account exists",
    );

    const mail = await waitForEmail(MAIL_DIR, email, /reset your/i);
    await page.goto(firstLink(mail));
    await page.getByLabel("New password").fill("kohbar on handmade paper");
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page).toHaveURL(/\/login\?reset=1/);

    await signIn(page, email, PASSWORD);
    await expect(page.locator("form").getByRole("alert")).toContainText(
      "not correct",
    );
    await signIn(page, email, "kohbar on handmade paper");
    await expect(page).toHaveURL(/\/account$/);
  });

  test("an unknown email gets the same message and a bad link is handled", async ({
    page,
  }, testInfo) => {
    await page.goto("/forgot-password");
    await page
      .getByLabel("Email address")
      .fill(uniqueEmail("nobody", testInfo));
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText(
      "If an account exists",
    );

    await page.goto("/reset-password?token=short");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "This link is not valid",
    );
  });
});

test.describe("account area", () => {
  test("saves profile details and manages addresses with one default", async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail("account", testInfo);
    await register(page, email);
    await signIn(page, email);

    await page.goto("/account/profile");
    await page.getByLabel("Phone number").fill("98765 43210");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByRole("status")).toContainText("saved");

    await page.goto("/account/addresses/new");
    await page.getByLabel("Label (optional)").fill("Home");
    await page.getByLabel("Recipient’s name").fill("Asha Devi");
    await page.getByLabel("Phone number").fill("+91 98765 43210");
    await page.getByLabel("Address", { exact: true }).fill("12 Station Road");
    await page.getByLabel("City").fill("Madhubani");
    await page.getByLabel("State").fill("Bihar");
    await page.getByLabel("PIN code").fill("847211");
    await page.getByRole("button", { name: "Add address" }).click();
    await expect(page).toHaveURL(/\/account\/addresses$/);
    await expect(page.getByText("Default")).toBeVisible();

    await page.getByRole("link", { name: "Add another address" }).click();
    await page.getByLabel("Label (optional)").fill("Office");
    await page.getByLabel("Recipient’s name").fill("Asha Devi");
    await page.getByLabel("Phone number").fill("+91 98765 43210");
    await page.getByLabel("Address", { exact: true }).fill("4 Market Lane");
    await page.getByLabel("City").fill("Patna");
    await page.getByLabel("State").fill("Bihar");
    await page.getByLabel("PIN code").fill("800001");
    await page.getByRole("button", { name: "Add address" }).click();

    await page.getByRole("button", { name: "Make default" }).click();
    const cards = page.locator("li[data-default]");
    await expect(cards).toHaveCount(2);
    await expect(page.locator('li[data-default="true"]')).toHaveCount(1);
    await expect(page.locator('li[data-default="true"]')).toContainText(
      "Office",
    );

    await page.getByRole("button", { name: "Delete" }).last().click();
    await expect(cards).toHaveCount(1);
  });

  test("changes the password, signs out other devices and lists sessions", async ({
    browser,
    page,
  }, testInfo) => {
    const email = uniqueEmail("devices", testInfo);
    await register(page, email);
    await signIn(page, email);

    const otherContext = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": fakeAddress() },
    });
    const other = await otherContext.newPage();
    await signIn(other, email);
    await expect(other).toHaveURL(/\/account$/);

    await page.goto("/account/security");
    await expect(
      page.locator("li").filter({ hasText: "Signed in" }),
    ).toHaveCount(2);

    await page.getByLabel("Current password").fill(PASSWORD);
    await page.getByLabel("New password").fill("lotus medallion dupatta");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("status")).toContainText(
      "other devices have been signed out",
    );

    await other.goto("/account");
    await expect(other).toHaveURL(/\/login/);
    await otherContext.close();

    await page.goto("/account/security");
    await expect(
      page.locator("li").filter({ hasText: "Signed in" }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Sign out everywhere" }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});

/** The sign-in form itself (the header carries search forms too). */
function signInForm(page: Page) {
  return page.locator("form").filter({ has: page.locator("#sign-in-email") });
}

/**
 * The browser-side checks need React mounted. The show-password toggle is
 * client state, so once a click flips the input type the page is hydrated;
 * the toggle is flipped back afterwards.
 */
async function waitForSignInHydration(page: Page) {
  const input = page.getByLabel("Password", { exact: true });
  await expect(async () => {
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(input).toHaveAttribute("type", "text", { timeout: 500 });
  }).toPass();
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(input).toHaveAttribute("type", "password");
}

test.describe("sign-in page", () => {
  test("catches empty and malformed entries before anything is sent", async ({
    page,
  }) => {
    await page.goto("/login");
    await waitForSignInHydration(page);
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(request.url());
    });

    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter your email address")).toBeVisible();
    await expect(page.getByText("Enter your password")).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeFocused();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Email address").fill("asha@");
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await expect(page.getByText("Enter your password")).toHaveCount(0);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    expect(posts).toEqual([]);

    // Correcting the field clears its message straight away.
    await page.getByLabel("Email address").fill("asha@example.com");
    await expect(page.getByText("Enter a valid email address")).toHaveCount(0);
  });

  test("shows a busy state while the sign-in request is in flight", async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail("busy", testInfo);
    await register(page, email);
    await page.goto("/login");
    await waitForSignInHydration(page);
    // Hold the action's POST so the pending state is observable.
    await page.route(
      (url) => url.pathname === "/login",
      async (route) => {
        if (route.request().method() === "POST") {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        await route.continue();
      },
    );
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    const busy = page.getByRole("button", { name: "Signing in…" });
    await expect(busy).toBeVisible();
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");
    await expect(page).toHaveURL(/\/account$/);
  });

  test("links to the password reset and to registration", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgotten your password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Reset your password",
    );

    await page.goto("/login");
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Create an account",
    );
  });

  test("ignores an off-site return path and sends a signed-in visitor on", async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail("onward", testInfo);
    await register(page, email);

    await page.goto("/login?next=https%3A%2F%2Fevil.example%2F");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/account$/);

    // Already signed in: the page never renders, the visitor is sent on.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/account$/);
    await page.goto("/login?next=%2Faccount%2Faddresses");
    await expect(page).toHaveURL(/\/account\/addresses$/);
    await page.goto("/login?next=//evil.example");
    await expect(page).toHaveURL(/\/account$/);
  });

  test("fits a small screen with comfortable targets and the form in view", async ({
    page,
  }, testInfo) => {
    test.skip(!isMobileProject(testInfo), "Mobile projects only");
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Welcome back",
    );
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const form = await signInForm(page).boundingBox();
    expect(form?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
      viewport?.height ?? 0,
    );
    for (const control of [
      page.getByLabel("Email address"),
      page.getByLabel("Password", { exact: true }),
      page.getByRole("button", { name: "Sign in" }),
    ]) {
      const box = await control.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("accessibility and keyboard", () => {
  test("auth pages have no axe violations", async ({ page }) => {
    for (const path of [
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password?token=short",
    ]) {
      await page.goto(path);
      await expectNoAxeViolations(page, path);
    }
  });

  test("account pages have no axe violations", async ({ page }, testInfo) => {
    const email = uniqueEmail("axe", testInfo);
    await register(page, email);
    await signIn(page, email);
    for (const path of [
      "/account",
      "/account/profile",
      "/account/addresses",
      "/account/addresses/new",
      "/account/security",
    ]) {
      await page.goto(path);
      await expectNoAxeViolations(page, path);
    }
  });

  test("the sign-in form is fully keyboard operable and the password toggle works", async ({
    page,
    browserName,
  }, testInfo) => {
    test.skip(
      isMobileProject(testInfo),
      "Keyboard flow is covered on desktop projects",
    );
    const email = uniqueEmail("keys", testInfo);
    await register(page, email);
    await page.goto("/login");
    await page.getByLabel("Email address").focus();
    await page.keyboard.type(email);
    await page.keyboard.press(tabKey(browserName));
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press(tabKey(browserName));
    await expect(
      page.getByRole("button", { name: "Show password" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
      "type",
      "text",
    );
    await page.keyboard.press("Enter");
    await page.keyboard.press(tabKey(browserName));
    await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/account$/);
  });
});
