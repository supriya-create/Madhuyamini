import { describe, expect, it } from "vitest";

import { generateReturnNumber, normalizeReturnNumber } from "./request-number";

describe("return numbers", () => {
  it("look like RT- plus eight unambiguous characters", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateReturnNumber()).toMatch(
        /^RT-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/,
      );
    }
  });

  it("normalises what a customer typed and refuses anything else", () => {
    expect(normalizeReturnNumber(" rt-abcdefgh ")).toBe("RT-ABCDEFGH");
    expect(normalizeReturnNumber("RTABCDEFGH")).toBe("RT-ABCDEFGH");
    expect(normalizeReturnNumber("RT-ABCDEFG0")).toBeNull();
    expect(normalizeReturnNumber("MY-ABCDEFGH")).toBeNull();
    expect(normalizeReturnNumber(42)).toBeNull();
  });
});
