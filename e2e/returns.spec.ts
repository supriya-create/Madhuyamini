import { expect, test } from "@playwright/test";

import { fakeAddress, register, signIn, uniqueEmail } from "./accounts";
import { placeCodOrder } from "./orders";
import { createStaffAccount, restockedUnits, signInStaff } from "./staff";
import { expectNoAxeViolations } from "./support";

/**
 * Customer returns, step 8.1 (docs/phase-8-returns-custom-artwork.md §11,
 * §12): a delivered order, a partial return request without photographs
 * (the reason does not need them), the staff review through inspection,
 * stock moving only at inspection, and the pages audited with axe. A
 * stranger's view of the request is a 404.
 */

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": fakeAddress() });
});

test.describe("customer returns", () => {
  test("requests a partial return, staff approve, receive and inspect; stock returns only at inspection", async ({
    page,
    browser,
  }, testInfo) => {
    test.slow();
    const customerEmail = uniqueEmail("return-customer", testInfo);
    await register(page, customerEmail);
    await signIn(page, customerEmail);
    const orderNumber = await placeCodOrder(page, customerEmail, 2);

    // Staff deliver the order.
    const staffContext = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": fakeAddress() },
    });
    const admin = await staffContext.newPage();
    const staffEmail = uniqueEmail("return-staff", testInfo);
    await createStaffAccount("STAFF", staffEmail);
    await signInStaff(admin, staffEmail);
    await admin.goto(`/admin/orders?q=${orderNumber}`);
    await admin.getByRole("link", { name: orderNumber }).click();
    await admin.getByText("Start processing", { exact: true }).click();
    await admin.getByRole("button", { name: "Mark as being prepared" }).click();
    await expect(admin.getByRole("status")).toContainText("being prepared");
    await admin.getByText("Ship", { exact: true }).click();
    await admin.getByLabel("Carrier").fill("India Post");
    await admin.getByRole("button", { name: "Record shipment" }).click();
    await expect(admin.getByRole("status")).toContainText("Shipment recorded");
    await admin.getByText("Delivered", { exact: true }).click();
    await admin.getByRole("button", { name: "Mark as delivered" }).click();
    await expect(admin.getByRole("status")).toContainText("delivered");

    // The customer asks to return one of the two units.
    await page.goto(`/account/orders/${orderNumber}`);
    await expect(
      page.getByRole("heading", { name: "Returns and exchanges" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Return or exchange items" }).click();
    await expect(page).toHaveURL(/\/account\/orders\/MY-[A-Z0-9]+\/return$/);
    await expectNoAxeViolations(page, "return request form");
    await page.getByRole("checkbox", { name: /Fish/ }).check();
    await page.getByLabel("How many").selectOption("1");
    await page.getByLabel("Reason").selectOption("SIZE_OR_FIT");
    await page
      .getByLabel("Tell us more (optional)")
      .fill("It is smaller than I expected.");
    await page
      .getByRole("checkbox", { name: /read the return instructions/ })
      .check();
    await page.getByRole("button", { name: "Send the return request" }).click();
    await expect(page).toHaveURL(
      /\/account\/returns\/RT-[A-Z0-9]+\?notice=requested$/,
    );
    await expect(page.getByRole("status").first()).toContainText(
      "return request has been sent",
    );
    const requestNumber = /RT-[A-Z0-9]{8}/.exec(page.url())?.[0] ?? "";
    expect(requestNumber).not.toBe("");
    await expectNoAxeViolations(page, "return detail");
    await page.goto("/account/returns");
    await expect(page.getByRole("link", { name: requestNumber })).toBeVisible();
    await expectNoAxeViolations(page, "returns list");

    // A stranger cannot see it.
    const strangerContext = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": fakeAddress() },
    });
    const stranger = await strangerContext.newPage();
    const strangerEmail = uniqueEmail("return-stranger", testInfo);
    await register(stranger, strangerEmail);
    await signIn(stranger, strangerEmail);
    const response = await stranger.goto(`/account/returns/${requestNumber}`);
    expect(response?.status()).toBe(404);
    await strangerContext.close();

    // Staff review it.
    await admin.goto("/admin/returns");
    await expectNoAxeViolations(admin, "returns queue");
    await admin.getByRole("link", { name: requestNumber }).click();
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText(
      `Return ${requestNumber}`,
    );
    await expectNoAxeViolations(admin, "return review");
    await admin.getByText("Approve", { exact: true }).click();
    await admin
      .getByLabel("Return instructions for the customer")
      .fill("Please post the parcel to the Madhuyamini studio, Madhubani.");
    await admin
      .getByRole("button", { name: "Approve and send instructions" })
      .click();
    await expect(admin.getByRole("status")).toContainText("Return approved");

    // The customer sends the parcel.
    await page.goto(`/account/returns/${requestNumber}`);
    await expect(page.getByText("How to send it back")).toBeVisible();
    await page.getByLabel("Carrier").fill("DTDC");
    await page.getByLabel("Tracking number (optional)").fill("D12345");
    await page.getByRole("button", { name: "I have sent the parcel" }).click();
    await expect(page.getByRole("status").first()).toContainText("Thank you");

    // Staff receive and inspect it.
    await admin.goto(`/admin/returns`);
    await admin.getByRole("link", { name: requestNumber }).click();
    await admin.getByText("Parcel received", { exact: true }).click();
    await admin
      .getByLabel("Condition of the parcel on arrival")
      .fill("Box intact.");
    await admin.getByRole("button", { name: "Record what arrived" }).click();
    await expect(admin.getByRole("status")).toContainText(
      "recorded as received",
    );
    expect(await restockedUnits(orderNumber)).toBe(0);

    await admin.getByText("Inspect the units", { exact: true }).click();
    await admin.getByRole("link", { name: "Open the inspection form" }).click();
    await expectNoAxeViolations(admin, "return inspection");
    await admin.getByLabel("Inspection note").fill("Resaleable.");
    await admin.getByRole("button", { name: "Record the inspection" }).click();
    await expect(admin.getByRole("status")).toContainText(
      "Inspection recorded",
    );
    expect(await restockedUnits(orderNumber)).toBe(1);

    // The customer sees the outcome.
    await page.goto(`/account/returns/${requestNumber}`);
    await expect(page.getByText("Inspected")).toBeVisible();
    await expect(page.getByText("1 accepted")).toBeVisible();
    await staffContext.close();
  });
});
