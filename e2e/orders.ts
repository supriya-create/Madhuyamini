import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Shared checkout steps for journeys that need an order to exist first. */

export async function fillAddress(page: Page) {
  await page.getByLabel("Recipient’s name").fill("Asha Devi");
  await page.getByLabel("Address", { exact: true }).fill("12 Station Road");
  await page.getByLabel("City").fill("Madhubani");
  await page.getByLabel("State").fill("Bihar");
  await page.getByLabel("PIN code").fill("847211");
}

export function orderNumberFrom(text: string | null): string {
  const match = /MY-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}/.exec(text ?? "");
  if (!match) throw new Error(`no order number in: ${text ?? ""}`);
  return match[0];
}

/** A cash-on-delivery order for the tote, placed by a signed-in customer; returns its number. */
export async function placeCodOrder(
  page: Page,
  email: string,
  quantity = 1,
): Promise<string> {
  await page.goto("/products/sample-fish-tote-bag");
  if (quantity > 1) {
    await page
      .getByLabel("Quantity", { exact: true })
      .selectOption(String(quantity));
  }
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByRole("status")).toContainText("Added to your cart");
  await page.goto("/checkout");
  await page.getByLabel("Phone number").fill("9876543210");
  await fillAddress(page);
  await page.getByLabel(/Cash on delivery/).check();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page).toHaveURL(/\/checkout\/confirmation\//);
  const heading = await page
    .getByRole("heading", { level: 2, name: /MY-/ })
    .textContent();
  if (!heading) throw new Error(`no order number for ${email}`);
  return orderNumberFrom(heading);
}
