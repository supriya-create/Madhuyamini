/**
 * Runs once when a Next.js server starts (not during `next build`). It parses
 * the environment, so a misconfigured server fails before its first request,
 * and in production refuses to start without a complete Razorpay
 * configuration (docs/environments.md).
 */
export async function register(): Promise<void> {
  // NEXT_RUNTIME and NEXT_PHASE are set by Next itself, not configuration.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const [{ env }, { assertPaymentReadiness }] = await Promise.all([
    import("@/server/env"),
    import("@/server/payments/readiness"),
  ]);
  assertPaymentReadiness(env);
}
