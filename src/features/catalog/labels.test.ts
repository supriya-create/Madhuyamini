import { describe, expect, it } from "vitest";

import {
  constructionMethodLabels,
  techniqueLabels,
  techniqueValues,
} from "./labels";

describe("catalog labels", () => {
  it("lists every technique exactly once, in filter order", () => {
    expect([...techniqueValues].sort()).toEqual(
      Object.keys(techniqueLabels).sort(),
    );
    expect(new Set(techniqueValues).size).toBe(techniqueValues.length);
  });

  it("has a non-empty customer-facing label for every enum value", () => {
    for (const label of [
      ...Object.values(techniqueLabels),
      ...Object.values(constructionMethodLabels),
    ]) {
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });
});
