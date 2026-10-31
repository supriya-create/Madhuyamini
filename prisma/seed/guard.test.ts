import { describe, expect, it } from "vitest";

import { assertSeedAllowed } from "./guard";

const local = "postgresql://app@localhost:5432/madhuyamini";
const remote = "postgresql://app:pw@db.neon.example:5432/madhuyamini";

describe("assertSeedAllowed", () => {
  it("allows local databases outside production", () => {
    expect(() =>
      assertSeedAllowed({
        databaseUrl: local,
        siteEnv: "development",
        allowRemote: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertSeedAllowed({
        databaseUrl: "postgresql://app@127.0.0.1/db",
        siteEnv: undefined,
        allowRemote: false,
      }),
    ).not.toThrow();
  });

  it("always refuses production, even for local hosts or with the override", () => {
    expect(() =>
      assertSeedAllowed({
        databaseUrl: local,
        siteEnv: "production",
        allowRemote: true,
      }),
    ).toThrow(/production/);
  });

  it("refuses remote hosts unless explicitly overridden", () => {
    expect(() =>
      assertSeedAllowed({
        databaseUrl: remote,
        siteEnv: "development",
        allowRemote: false,
      }),
    ).toThrow(/non-local/);
    expect(() =>
      assertSeedAllowed({
        databaseUrl: remote,
        siteEnv: "development",
        allowRemote: true,
      }),
    ).not.toThrow();
  });

  it("refuses malformed URLs", () => {
    expect(() =>
      assertSeedAllowed({
        databaseUrl: "nope",
        siteEnv: "development",
        allowRemote: false,
      }),
    ).toThrow(/valid URL/);
  });
});
