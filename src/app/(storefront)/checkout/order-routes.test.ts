import { describe, expect, it, vi } from "vitest";

import { routes } from "@/lib/routes";
import type { OrderAccess } from "@/server/orders/context";

/**
 * The order routes (pay, confirming, confirmation) settle "not found" before
 * anything renders (audit batch 3, B-12): a malformed id is refused without
 * touching the database, an unknown id is not found or redirected by access
 * kind, and a database failure propagates as the error it is, never as a
 * 404. The routes sit outside the checkout loading boundary, so what they
 * throw here is what the HTTP status becomes (e2e/checkout.spec.ts).
 */

const { findAccessibleOrder, resolveOrderAccess } = vi.hoisted(() => ({
  findAccessibleOrder:
    vi.fn<(access: OrderAccess, orderId: string) => Promise<null>>(),
  resolveOrderAccess: vi.fn<() => Promise<OrderAccess>>(),
}));

class NotFoundSignal extends Error {
  constructor() {
    super("NEXT_HTTP_ERROR_FALLBACK;404");
  }
}

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT;${url}`);
  }
}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundSignal();
  },
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("@/features/orders/service", () => ({ findAccessibleOrder }));
vi.mock("@/server/orders/context", () => ({ resolveOrderAccess }));
vi.mock("@/features/payments/data", () => ({ findOpenAttempt: vi.fn() }));
vi.mock("@/server/payments", () => ({
  getPaymentGateway: vi.fn(),
  isFakeGateway: () => false,
}));
vi.mock("@/features/checkout/actions", () => ({
  cancelPendingOrderAction: vi.fn(),
  startPaymentAttemptAction: vi.fn(),
  confirmPaymentAction: vi.fn(),
  recordPaymentFailureAction: vi.fn(),
  simulatePaymentAction: vi.fn(),
  checkOrderStatusAction: vi.fn(),
}));

const UNKNOWN = "11111111-2222-4333-8444-555555555555";

function props(orderId: string) {
  return {
    params: Promise.resolve({ orderId }),
    searchParams: Promise.resolve<
      Record<string, string | string[] | undefined>
    >({}),
  };
}

async function loadPages() {
  const [pay, confirming, confirmation] = await Promise.all([
    import("./pay/[orderId]/page"),
    import("./confirming/[orderId]/page"),
    import("./confirmation/[orderId]/page"),
  ]);
  return {
    pay: pay.default,
    confirming: confirming.default,
    confirmation: confirmation.default,
  };
}

describe("checkout order routes (B-12)", () => {
  it("refuses a malformed id before any lookup", async () => {
    const pages = await loadPages();
    for (const page of Object.values(pages)) {
      await expect(page(props("not-a-uuid"))).rejects.toBeInstanceOf(
        NotFoundSignal,
      );
    }
    expect(resolveOrderAccess).not.toHaveBeenCalled();
    expect(findAccessibleOrder).not.toHaveBeenCalled();
  });

  it("lets a database failure surface as the error it is, never as a 404", async () => {
    const pages = await loadPages();
    resolveOrderAccess.mockResolvedValue({ kind: "anonymous" });
    findAccessibleOrder.mockRejectedValue(new Error("connection refused"));
    for (const page of Object.values(pages)) {
      const outcome = page(props(UNKNOWN));
      await expect(outcome).rejects.toThrow("connection refused");
      await expect(outcome).rejects.not.toBeInstanceOf(NotFoundSignal);
    }
  });

  it("sends a guest with an unknown id to sign in or to order tracking", async () => {
    const { pay, confirming, confirmation } = await loadPages();
    resolveOrderAccess.mockResolvedValue({ kind: "anonymous" });
    findAccessibleOrder.mockResolvedValue(null);
    await expect(pay(props(UNKNOWN))).rejects.toMatchObject({
      url: `${routes.login}?next=${encodeURIComponent(routes.checkoutPay(UNKNOWN))}`,
    });
    await expect(confirmation(props(UNKNOWN))).rejects.toMatchObject({
      url: routes.trackOrder,
    });
    // Confirming has nothing to offer a guest without the order: not found.
    await expect(confirming(props(UNKNOWN))).rejects.toBeInstanceOf(
      NotFoundSignal,
    );
  });

  it("gives a signed-in customer a 404 for an order that is not theirs", async () => {
    const { pay, confirmation } = await loadPages();
    resolveOrderAccess.mockResolvedValue({ kind: "user", userId: "user-1" });
    findAccessibleOrder.mockResolvedValue(null);
    for (const page of [pay, confirmation]) {
      await expect(page(props(UNKNOWN))).rejects.toBeInstanceOf(NotFoundSignal);
    }
  });
});
