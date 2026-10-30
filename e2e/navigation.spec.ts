import { expect, test } from "@playwright/test";

import { isMobileProject, tabKey } from "./support";

test.describe("skip link", () => {
  test("is the first focusable element and moves focus to the main content", async ({
    page,
    browserName,
  }) => {
    await page.goto("/");
    await page.keyboard.press(tabKey(browserName));

    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeInViewport();

    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });
});

test.describe("desktop navigation", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      isMobileProject(testInfo),
      "Desktop navigation is hidden on small screens",
    );
  });

  test("category disclosures open with the keyboard and close with Escape", async ({
    page,
    browserName,
  }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    const trigger = nav.getByRole("button", { name: "Clothing" });

    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.focus();
    await page.keyboard.press("Enter");

    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const panel = page.locator("#nav-panel-clothing");
    await expect(panel).toBeVisible();

    await page.keyboard.press(tabKey(browserName));
    await expect(
      panel.getByRole("link", { name: "All clothing" }),
    ).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("only one panel is open at a time and clicking outside closes it", async ({
    page,
  }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    const clothing = nav.getByRole("button", { name: "Clothing" });
    const wallArt = nav.getByRole("button", { name: "Wall Art" });

    await clothing.click();
    await wallArt.click();
    await expect(clothing).toHaveAttribute("aria-expanded", "false");
    await expect(wallArt).toHaveAttribute("aria-expanded", "true");

    await page.getByRole("heading", { level: 1 }).click();
    await expect(wallArt).toHaveAttribute("aria-expanded", "false");
  });

  test("tabbing out of an open panel closes it", async ({
    page,
    browserName,
  }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    const trigger = nav.getByRole("button", { name: "Accessories" });

    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    // Accessories has 7 links; tab past all of them and the two extra nav links.
    for (let i = 0; i < 10; i += 1)
      await page.keyboard.press(tabKey(browserName));
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  // Regression: Safari moves focus to <body> when a link is clicked, which must
  // not close the panel before the click lands.
  test("a panel opened with the keyboard still follows mouse clicks on its links", async ({
    page,
  }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    const trigger = nav.getByRole("button", { name: "Clothing" });

    await trigger.focus();
    await page.keyboard.press("Enter");
    await page
      .locator("#nav-panel-clothing")
      .getByRole("link", { name: "Sarees" })
      .click();

    await expect(page).toHaveURL(/\/collections\/sarees$/);
  });
});

test.describe("mobile navigation", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !isMobileProject(testInfo),
      "The menu drawer is only used on small screens",
    );
  });

  test("opens as a modal dialog, contains focus and returns it on Escape", async ({
    page,
    browserName,
  }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Menu" });
    const dialog = page.getByRole("dialog", { name: "Menu" });

    await expect(dialog).toBeHidden();
    await trigger.click();
    await expect(dialog).toBeVisible();

    // Focus must never reach the page behind the modal.
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press(tabKey(browserName));
      const escaped = await page.evaluate(() => {
        const active = document.activeElement;
        const dialogElement = document.getElementById("mobile-menu");
        return Boolean(
          active &&
          active !== document.body &&
          !dialogElement?.contains(active),
        );
      });
      expect(escaped, `focus left the dialog after ${i + 1} tabs`).toBe(false);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("category groups expand and the close button dismisses the menu", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    const dialog = page.getByRole("dialog", { name: "Menu" });

    const sarees = dialog.getByRole("link", { name: "Sarees" });
    await expect(sarees).toBeHidden();
    await dialog.getByText("Clothing", { exact: true }).click();
    await expect(sarees).toBeVisible();

    await dialog.getByRole("button", { name: "Close menu" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Menu" })).toBeFocused();
  });

  test("page scrolling is locked while the menu is open", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.locator("html")).toHaveCSS("overflow", "hidden");

    await page.keyboard.press("Escape");
    await expect(page.locator("html")).not.toHaveCSS("overflow", "hidden");
  });
});
