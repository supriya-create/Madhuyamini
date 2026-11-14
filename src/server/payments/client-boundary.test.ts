import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Gateway selection and credentials stay on the server. These scans guard
 * the boundary statically: no client component reaches into the server
 * modules, nothing reads payment variables outside the environment schema,
 * and nothing is published through NEXT_PUBLIC_ variables.
 */

function listSource(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "generated") continue;
      files.push(...listSource(path));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

/** Type-only imports are erased by the compiler and never reach a bundle. */
function withoutTypeImports(source: string): string {
  return source.replace(/import\s+type\b[\s\S]*?from\s+["'][^"']+["'];?/g, "");
}

const sources = listSource("src").map((file) => ({
  file,
  source: withoutTypeImports(readFileSync(file, "utf8")),
}));

describe("payment gateway client boundary", () => {
  it("lets no client component import server modules or the fake gateway secrets", () => {
    const offenders = sources
      .filter(({ source }) => /^\s*["']use client["']/m.test(source))
      .filter(
        ({ source }) =>
          /from\s+["']@\/server\//.test(source) ||
          /fake-secrets/.test(source) ||
          /from\s+["']@\/features\/[^"']+\/(service|data)["']/.test(source),
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("reads payment and gateway variables only in the environment schema", () => {
    const offenders = sources
      .filter(({ file }) => !file.endsWith("src/server/env-schema.ts"))
      .filter(({ source }) =>
        /process\.env\.(PAYMENT_GATEWAY|RAZORPAY_[A-Z_]+)/.test(source),
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("publishes nothing through NEXT_PUBLIC_ variables", () => {
    const offenders = sources
      .filter(({ source }) => source.includes("NEXT_PUBLIC_"))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("keeps the fake gateway secrets out of every module except the fake gateway itself", () => {
    const importers = sources
      .filter(({ source }) => /from\s+["'][^"']*fake-secrets["']/.test(source))
      .map(({ file }) => file)
      .sort();
    expect(importers).toEqual(["src/server/payments/fake.ts"]);
  });
});
