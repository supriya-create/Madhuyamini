/**
 * Internal links that point at routes built in later phases.
 *
 * The link audit (links.spec.ts) asserts each of these still returns 404, so
 * this list must shrink as routes are built — it cannot silently go stale.
 * It must be empty before launch (docs/roadmap.md, Phase 11).
 */
export const PENDING_ROUTE_PREFIXES: ReadonlyArray<{
  prefix: string;
  phase: number;
}> = [
  { prefix: "/custom-artwork", phase: 8 },
  { prefix: "/policies/", phase: 9 },
  { prefix: "/care-guide", phase: 9 },
  { prefix: "/contact", phase: 9 },
];

export function pendingPhaseFor(pathname: string): number | undefined {
  return PENDING_ROUTE_PREFIXES.find(({ prefix }) =>
    pathname.startsWith(prefix),
  )?.phase;
}
