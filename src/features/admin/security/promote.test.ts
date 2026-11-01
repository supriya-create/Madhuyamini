import { describe, expect, it } from "vitest";

import { isLocalDatabase } from "./promote";

describe("isLocalDatabase", () => {
  it("recognises loopback hosts only", () => {
    expect(isLocalDatabase("postgresql://u:p@localhost:5432/db")).toBe(true);
    expect(isLocalDatabase("postgresql://u:p@127.0.0.1/db")).toBe(true);
    expect(isLocalDatabase("postgresql://u:p@[::1]:5432/db")).toBe(true);
    expect(isLocalDatabase("postgresql://u:p@db.example.com/db")).toBe(false);
    expect(isLocalDatabase("postgresql://u:p@localhost.example.com/db")).toBe(
      false,
    );
    expect(isLocalDatabase("not a url")).toBe(false);
  });
});
