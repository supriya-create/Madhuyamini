/** Pure session-lifetime rules shared by the data-access layer and its tests. */

export const SESSION_ABSOLUTE_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

/** P4: a session older than the absolute lifetime is rejected even if still active. */
export function isWithinAbsoluteLifetime(
  createdAt: Date | string,
  now = Date.now(),
): boolean {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  return now - created <= SESSION_ABSOLUTE_LIFETIME_SECONDS * 1000;
}
