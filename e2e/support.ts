import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

export const isMobileProject = (testInfo: TestInfo) =>
  testInfo.project.name.startsWith("mobile-");

/**
 * WebKit on macOS skips links when tabbing unless Alt is held (mirrors Safari's
 * default "Press Tab to highlight each item" setting being off).
 */
export function tabKey(browserName: string): string {
  return browserName === "webkit" && process.platform === "darwin"
    ? "Alt+Tab"
    : "Tab";
}

/** WCAG 2.0–2.2 A and AA rules. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export async function expectNoAxeViolations(page: Page, context?: string) {
  // Next.js streams metadata after the initial UI, so right after a
  // navigation the document can be a moment without its <title>. Wait for
  // it: a page that never sets one still fails here, with a clear message.
  await expect(page).toHaveTitle(/\S/);
  // Target sizes depend on the final layout: wait for web fonts, and start
  // from the top so the sticky header overlaps nothing being measured.
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(" ")),
    // Why each node failed, so a report is actionable without re-running.
    details: violation.nodes.map((node) => node.failureSummary ?? ""),
  }));
  expect(
    summary,
    context ? `axe violations (${context})` : "axe violations",
  ).toEqual([]);
}
