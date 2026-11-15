/**
 * The one sentence every rate-limited action shows. It names the real wait
 * (rounded up to whole minutes) so a ten-minute window is never described as
 * "a minute"; it carries no identifying detail.
 */
export const TRY_LATER =
  "Too many attempts. Please wait a little while and try again.";

export function rateLimitedMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `${TRY_LATER} (About ${minutes} minute${minutes === 1 ? "" : "s"}.)`;
}
