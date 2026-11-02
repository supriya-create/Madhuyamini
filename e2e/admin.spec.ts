import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { fakeAddress, register, signIn, uniqueEmail } from "./accounts";
import { fillAddress, placeCodOrder } from "./orders";
import {
  ageVerification,
  codeFor,
  createStaffAccount,
  enrolTwoFactor,
  signInForAdmin,
  signInStaff,
} from "./staff";
import { expectNoAxeViolations } from "./support";

/**
 * Admin journeys (docs/admin.md §11): the gate, enrolment and verification,
 * fulfilment with return to origin for a cash-on-delivery order, customer
 * data grants with immediate revocation, and re-authentication for a
 * sensitive action. Every admin page visited is audited with axe.
 */

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": fakeAddress() });
});

/** An online order for two totes, paid through the fake gateway; returns its number. */
async function placeOnlineOrder(page: Page, email: string): Promise<string> {
  await page.goto("/products/sample-fish-tote-bag");
  await page.getByLabel("Quantity", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByRole("status")).toContainText("Added to your cart");
  await page.goto("/checkout");
  await page.getByLabel("Phone number").fill("9876543210");
  await fillAddress(page);
  await expect(page.getByLabel(/Pay online/)).toBeChecked();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page).toHaveURL(/\/checkout\/pay\/[0-9a-f-]+$/);
  await page
    .getByRole("button", { name: "Simulate successful payment" })
    .click();
  await expect(page).toHaveURL(/\/checkout\/confirmation\/.*placed=1$/);
  const heading = await page
    .getByRole("heading", { level: 2, name: /MY-/ })
    .textContent();
  const match = /MY-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}/.exec(heading ?? "");
  if (!match) throw new Error(`no order number for ${email}`);
  return match[0];
}

const grantForm = (page: Page) =>
  page.getByRole("region", { name: "Grant access to this customer" });

test.describe("the staff gate", () => {
  test("hides the admin from customers and visitors, and enrols staff before anything else", async ({
    page,
  }, testInfo) => {
    test.slow();
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);

    const customerEmail = uniqueEmail("customer", testInfo);
    await register(page, customerEmail);
    await signIn(page, customerEmail);
    const response = await page.goto("/admin");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "couldn’t find",
    );
    await page.goto("/account/security");
    await expect(page.getByText("Two-factor sign-in")).toHaveCount(0);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();

    const staffEmail = uniqueEmail("staff", testInfo);
    await createStaffAccount("STAFF", staffEmail);
    await signInForAdmin(page, staffEmail);
    await expect(page).toHaveURL(
      /\/account\/security\/two-factor\?next=%2Fadmin/,
    );
    await expectNoAxeViolations(page, "two-factor setup");
    const codes = await enrolTwoFactor(page);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Overview",
    );
    await expectNoAxeViolations(page, "admin overview");

    // Staff do not see admin-only navigation, and the audit page is not there for them.
    await expect(page.getByRole("link", { name: "Audit" })).toHaveCount(0);
    const audit = await page.goto("/admin/audit");
    expect(audit?.status()).toBe(404);

    // A new session must pass the second factor again; a recovery code works once.
    await page.goto("/admin");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await signInForAdmin(page, staffEmail);
    await expect(page).toHaveURL(/\/login\/verify/);
    await expectNoAxeViolations(page, "verify sign-in");
    await page.getByLabel("A recovery code").check();
    const [code] = codes;
    if (!code) throw new Error("no recovery code");
    await page.getByRole("textbox", { name: "Recovery code" }).fill(code);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/account/security/two-factor");
    await expect(page.getByText("Recovery codes left: 9")).toBeVisible();
  });

  test("audits the main admin pages", async ({ page }, testInfo) => {
    const email = uniqueEmail("auditor", testInfo);
    await createStaffAccount("ADMIN", email);
    await signInStaff(page, email);
    for (const [path, name] of [
      ["/admin/orders", "orders"],
      ["/admin/payments/review", "payment review"],
      ["/admin/payments/refunds", "refunds"],
      ["/admin/operations", "operations"],
      ["/admin/inventory", "inventory"],
      ["/admin/catalogue/products", "products"],
      ["/admin/catalogue/categories", "categories"],
      ["/admin/customers", "customers"],
      ["/admin/reports", "reports"],
      ["/admin/audit", "audit"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();
      await expectNoAxeViolations(page, name);
    }
  });
});

test.describe("fulfilment and return to origin", () => {
  test("ships a cash-on-delivery order, records the refusal, and restocks only after inspection", async ({
    page,
    browser,
  }, testInfo) => {
    test.slow();
    const customerEmail = uniqueEmail("rto-customer", testInfo);
    await register(page, customerEmail);
    await signIn(page, customerEmail);
    const orderNumber = await placeCodOrder(page, customerEmail);

    const staff = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": fakeAddress() },
    });
    const admin = await staff.newPage();
    const staffEmail = uniqueEmail("rto-staff", testInfo);
    await createStaffAccount("STAFF", staffEmail);
    await signInStaff(admin, staffEmail);

    await admin.goto(`/admin/orders?q=${orderNumber}`);
    await admin.getByRole("link", { name: orderNumber }).click();
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
      `Order ${orderNumber}`,
    );
    await expectNoAxeViolations(admin, "order detail");

    // The address is visible while fulfilling.
    await expect(admin.getByText("12 Station Road")).toBeVisible();

    await admin.getByText("Start processing", { exact: true }).click();
    await admin.getByRole("button", { name: "Mark as being prepared" }).click();
    await expect(admin.getByRole("status")).toContainText("being prepared");

    await admin.getByText("Ship", { exact: true }).click();
    await admin.getByLabel("Carrier").fill("India Post");
    await admin.getByLabel("Tracking number (optional)").fill("RB123456789IN");
    await admin.getByRole("button", { name: "Record shipment" }).click();
    await expect(admin.getByRole("status")).toContainText("Shipment recorded");

    await admin.getByText("Delivery failed", { exact: true }).click();
    await admin.getByLabel("What happened?").selectOption("COD_REFUSED");
    await admin
      .getByRole("button", { name: "Record delivery failure" })
      .click();
    await expect(admin.getByRole("status")).toContainText(
      "returning to origin",
    );
    await expect(
      admin.getByText("Customer refused (cash on delivery)"),
    ).toBeVisible();

    await admin.getByText("Parcel received back", { exact: true }).click();
    await admin.getByLabel("Condition on arrival").fill("Box intact.");
    await admin.getByRole("button", { name: "Record parcel returned" }).click();
    await expect(admin.getByRole("status")).toContainText(
      "Inspect it to close",
    );

    await admin.getByText("Inspect and close", { exact: true }).click();
    await admin.getByRole("link", { name: "Open the inspection form" }).click();
    await expectNoAxeViolations(admin, "inspection");
    await admin.getByLabel("Inspection note").fill("Resaleable.");
    await admin
      .getByRole("button", { name: "Record inspection and close the order" })
      .click();
    await expect(admin.getByRole("status")).toContainText(
      "stock adjusted and the order closed",
    );
    await expect(admin.getByText("RESTOCK ON RETURN +1")).toBeVisible();
    await expect(admin.getByText("CANCELLED").first()).toBeVisible();
    // Contact details are masked again once the order is closed.
    await expect(admin.getByText("12 Station Road")).toHaveCount(0);

    await staff.close();
  });
});

test.describe("customer data grants", () => {
  test("a grant lets staff reveal a field; revoking it masks the field at once; sensitive actions re-authenticate", async ({
    page,
    browser,
  }, testInfo) => {
    test.slow();
    const customerEmail = uniqueEmail("grant-customer", testInfo);
    await register(page, customerEmail, "Bina Jha");

    const adminEmail = uniqueEmail("grant-admin", testInfo);
    const staffEmail = uniqueEmail("grant-staff", testInfo);
    const adminUser = await createStaffAccount("ADMIN", adminEmail);
    // Unique per run: the staff directory accumulates accounts across runs.
    const staffName = `Grant Staff ${Date.now()}`;
    await createStaffAccount("STAFF", staffEmail, staffName);

    const adminContext = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": fakeAddress() },
    });
    const admin = await adminContext.newPage();
    const adminKey = await signInStaff(admin, adminEmail);

    const staffContext = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": fakeAddress() },
    });
    const staff = await staffContext.newPage();
    await signInStaff(staff, staffEmail);

    // Staff see the customer masked and cannot reveal.
    await staff.goto(`/admin/customers?q=${encodeURIComponent(customerEmail)}`);
    await staff.getByRole("link", { name: "Bina Jha" }).click();
    await expect(staff.getByText("You hold no active grant")).toBeVisible();
    await expect(staff.getByText(customerEmail)).toHaveCount(0);
    const customerUrl = staff.url();

    // Issuing a grant is sensitive: an aged verification sends the admin to re-auth first.
    expect(await ageVerification(adminUser.id, 30)).toBe(1);
    await admin.goto(customerUrl);
    await admin
      .getByLabel("Staff member")
      .selectOption({ label: `${staffName} (staff)` });
    await grantForm(admin).getByLabel("email", { exact: true }).check();
    await grantForm(admin)
      .getByLabel("Reason")
      .fill("Delivery query from the customer.");
    await admin.getByRole("button", { name: "Issue grant" }).click();
    await expect(admin).toHaveURL(/\/admin\/reauth/);
    await expectNoAxeViolations(admin, "re-authentication");
    // Enrolment used the current step; the next one is inside the window.
    await admin
      .getByLabel("Six-digit code")
      .fill(codeFor(adminKey, new Date(Date.now() + 30_000)));
    await admin.getByRole("button", { name: "Confirm and continue" }).click();
    await expect(admin).toHaveURL(customerUrl);
    await admin
      .getByLabel("Staff member")
      .selectOption({ label: `${staffName} (staff)` });
    await grantForm(admin).getByLabel("email", { exact: true }).check();
    await grantForm(admin)
      .getByLabel("Reason")
      .fill("Delivery query from the customer.");
    await admin.getByRole("button", { name: "Issue grant" }).click();
    await expect(admin.getByRole("status")).toContainText("Grant issued");

    // Staff reveal the email under the grant.
    await staff.reload();
    await staff.getByText("Reveal fields", { exact: true }).click();
    await staff
      .getByRole("region", { name: "Contact and addresses" })
      .getByLabel("email", { exact: true })
      .check();
    await staff.getByLabel("Why?").fill("Confirming the delivery address.");
    await staff.getByRole("button", { name: "Reveal for 10 minutes" }).click();
    await expect(staff.getByRole("status")).toContainText("recorded");
    await expect(staff.getByText(customerEmail)).toBeVisible();

    // The admin revokes; the staff member's next render is masked again.
    await admin.reload();
    await admin.getByRole("button", { name: "Revoke now" }).first().click();
    await expect(admin.getByRole("status")).toContainText("Grant revoked");
    await staff.reload();
    await expect(staff.getByText(customerEmail)).toHaveCount(0);
    await expect(staff.getByText("You hold no active grant")).toBeVisible();

    await adminContext.close();
    await staffContext.close();
  });
});

test.describe("refunds", () => {
  test("a resubmitted refund form queues one refund; the same key with another amount is refused", async ({
    page,
    browser,
  }, testInfo) => {
    test.slow();
    const customerEmail = uniqueEmail("refund-customer", testInfo);
    await register(page, customerEmail);
    await signIn(page, customerEmail);
    const orderNumber = await placeOnlineOrder(page, customerEmail);

    const adminEmail = uniqueEmail("refund-admin", testInfo);
    await createStaffAccount("ADMIN", adminEmail);
    const adminContext = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": fakeAddress() },
    });
    const admin = await adminContext.newPage();
    await signInStaff(admin, adminEmail);
    await admin.goto(`/admin/orders?q=${orderNumber}`);
    await admin.getByRole("link", { name: orderNumber }).click();
    await expect(admin.getByRole("heading", { level: 1 })).toContainText(
      `Order ${orderNumber}`,
    );

    // The group is a collapsed disclosure on every render: open it first.
    const refundGroup = admin.locator("details", {
      has: admin.locator("summary", { hasText: /^Refund$/ }),
    });
    const openRefundGroup = async () => {
      if (!(await refundGroup.evaluate((d) => (d as HTMLDetailsElement).open)))
        await refundGroup.locator("summary").click();
    };
    const refundForm = () =>
      admin.locator("form", {
        has: admin.getByRole("button", { name: "Queue the refund" }),
      });
    const keyInput = () => refundForm().locator('input[name="operationKey"]');
    const replayKey = async (value: string) => {
      await openRefundGroup();
      await keyInput().evaluate((input, replayed) => {
        (input as HTMLInputElement).value = replayed;
      }, value);
    };
    const submit = async (amount: string) => {
      await openRefundGroup();
      await refundForm().getByLabel("Amount (₹)").fill(amount);
      await refundForm().getByLabel("Reason").fill("Late delivery.");
      await refundForm()
        .getByRole("button", { name: "Queue the refund" })
        .click();
    };

    // Each render of the form carries its own key.
    await openRefundGroup();
    const key = await keyInput().inputValue();
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    await submit("100");
    await expect(admin.getByRole("status")).toContainText("Refund queued");
    await openRefundGroup();
    expect(await keyInput().inputValue()).not.toBe(key);

    // The browser re-sends the earlier form (a retried request, the back
    // button): same key, same amount, and nothing new is created.
    await replayKey(key);
    await submit("100");
    await expect(admin.getByRole("status")).toContainText(
      "nothing new was created",
    );

    // The earlier form edited to another amount is not the same operation.
    await replayKey(key);
    await submit("50");
    await expect(refundForm().getByRole("alert")).toContainText(
      "already used for a different refund",
    );

    await admin.goto("/admin/payments/refunds");
    await expect(
      admin.getByText(`${orderNumber}-R1`, { exact: true }),
    ).toBeVisible();
    await expect(admin.getByText(`${orderNumber}-R1-2`)).toHaveCount(0);
    await expectNoAxeViolations(admin, "refunds");
    await adminContext.close();
  });
});
