import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import {
  FAKE_KEY_SECRET,
  FAKE_WEBHOOK_SECRET,
} from "../src/server/payments/fake-secrets";

/**
 * Payment credentials stay on the server (docs/environments.md §2). The
 * production build the suite runs against is on disk, so its client bundles
 * can be read directly: nothing that signs a payment may be in them.
 */

function listFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) files.push(...listFiles(path));
    else files.push(path);
  }
  return files;
}

test("client bundles carry no payment secrets", async ({
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The build is the same for every project",
  );
  const bundles = listFiles(join(process.cwd(), ".next", "static")).filter(
    (file) => file.endsWith(".js") || file.endsWith(".css"),
  );
  expect(bundles.length).toBeGreaterThan(0);

  const forbidden = [
    FAKE_KEY_SECRET,
    FAKE_WEBHOOK_SECRET,
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
    "BETTER_AUTH_SECRET",
    "simulatePayment(", // the fake gateway itself must not be bundled
  ];
  const leaks: string[] = [];
  for (const file of bundles) {
    const source = readFileSync(file, "utf8");
    for (const needle of forbidden) {
      if (source.includes(needle)) leaks.push(`${file}: ${needle}`);
    }
  }
  expect(leaks).toEqual([]);
  // The served chunks are the same files; one request proves the server is up.
  expect((await request.get("/robots.txt")).status()).toBe(200);
});

test("the storefront publishes no gateway secret in its HTML", async ({
  request,
}) => {
  for (const path of ["/", "/checkout", "/cart"]) {
    const html = await (await request.get(path)).text();
    expect(html, path).not.toContain(FAKE_KEY_SECRET);
    expect(html, path).not.toContain(FAKE_WEBHOOK_SECRET);
  }
});
