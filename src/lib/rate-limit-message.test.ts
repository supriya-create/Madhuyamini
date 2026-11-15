import { describe, expect, it } from "vitest";

import { TRY_LATER, rateLimitedMessage } from "./rate-limit-message";

describe("rateLimitedMessage", () => {
  it("rounds the wait up to whole minutes and never says less than one", () => {
    expect(rateLimitedMessage(1)).toBe(`${TRY_LATER} (About 1 minute.)`);
    expect(rateLimitedMessage(60)).toBe(`${TRY_LATER} (About 1 minute.)`);
    expect(rateLimitedMessage(61)).toBe(`${TRY_LATER} (About 2 minutes.)`);
    expect(rateLimitedMessage(10 * 60)).toBe(
      `${TRY_LATER} (About 10 minutes.)`,
    );
    expect(rateLimitedMessage(0)).toBe(`${TRY_LATER} (About 1 minute.)`);
  });
});
