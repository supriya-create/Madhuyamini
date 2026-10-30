import { afterEach, describe, expect, it, vi } from "vitest";

async function loadWithEnvironment(isProduction: boolean) {
  vi.resetModules();
  vi.doMock("@/server/env", () => ({ isProduction }));
  return import("./ImagePending");
}

describe("ImagePending", () => {
  afterEach(() => {
    vi.doUnmock("@/server/env");
  });

  it("renders a labelled placeholder outside production", async () => {
    const { ImagePending } = await loadWithEnvironment(false);
    expect(() =>
      ImagePending({ description: "Hero photograph" }),
    ).not.toThrow();
  });

  it("refuses to render in production so a placeholder can never ship", async () => {
    const { ImagePending } = await loadWithEnvironment(true);
    expect(() => ImagePending({ description: "Hero photograph" })).toThrow(
      /production/,
    );
  });
});
