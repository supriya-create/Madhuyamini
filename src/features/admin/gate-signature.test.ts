import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Refinement 6 of docs/admin.md: every protected admin read and mutation
 * takes a StaffContext (or, for the pre-gate security flows, the signed-in
 * CurrentUser) as its first parameter, so authorisation cannot be skipped
 * by calling the function from somewhere other than the admin layout.
 */

const ROOT = join(__dirname);

function listModules(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return listModules(path);
    return /^(data|service)\.ts$/.test(entry) ? [path] : [];
  });
}

/** Pre-gate flows act on the signed-in user, before a StaffContext can exist. */
const PRE_GATE = new Set([
  "beginEnrolment",
  "pendingEnrolment",
  "confirmEnrolment",
  "verifySecondFactor",
  "regenerateRecoveryCodes",
  "securityStatus",
]);

/** Pure helpers exported for the UI; they read nothing. */
const PURE = new Set(["secondsUntilNextStep"]);

describe("admin data and service signatures", () => {
  const modules = listModules(ROOT);

  it("finds the admin modules", () => {
    expect(modules.length).toBeGreaterThan(0);
  });

  for (const file of modules) {
    it(`${file.replace(ROOT, "features/admin")} starts with server-only and gates every export`, () => {
      const source = readFileSync(file, "utf8");
      expect(source.startsWith('import "server-only";')).toBe(true);
      const exports = [
        ...source.matchAll(
          /export (?:async )?function (\w+)\s*(?:<[^>]*>)?\(\s*([^,)]*)/g,
        ),
      ];
      expect(exports.length).toBeGreaterThan(0);
      for (const [, name, firstParam] of exports) {
        if (!name || PURE.has(name)) continue;
        const param = (firstParam ?? "").replace(/\s+/g, " ").trim();
        if (PRE_GATE.has(name)) {
          expect(param, `${name} in ${file}`).toMatch(/^user: CurrentUser/);
        } else {
          expect(param, `${name} in ${file}`).toMatch(/^ctx: StaffContext/);
        }
      }
    });
  }
});
