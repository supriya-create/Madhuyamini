import type { PaymentMethod } from "@/generated/prisma/enums";
import type { CartLineView, CartView } from "@/features/cart/types";
import type { AddressRow } from "@/features/account/data";

import type { CodRefusal, Quote, QuoteProblem } from "./rules";

/** What a customer can choose at checkout; store credit is set by the shop (Phase 8). */
export type CheckoutPaymentMethod = Exclude<PaymentMethod, "STORE_CREDIT">;

/** The delivery address as copied onto the order. */
export interface AddressSnapshot {
  readonly recipientName: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly landmark: string | null;
  readonly city: string;
  readonly state: string;
  readonly postalCode: string;
  readonly country: string;
}

export interface CheckoutCustomer {
  readonly userId: string | null;
  /** Lower-cased. */
  readonly email: string;
  /** E.164. */
  readonly phone: string;
}

export interface PlaceOrderInput {
  /** The cart the page was rendered from; ownership is verified against the request's identity. */
  readonly cartId: string;
  readonly identity:
    | { readonly kind: "user"; readonly userId: string }
    | { readonly kind: "guest"; readonly tokenHash: string };
  readonly customer: CheckoutCustomer;
  readonly address: AddressSnapshot;
  readonly paymentMethod: CheckoutPaymentMethod;
  readonly quoteHash: string;
  readonly customerNote: string | null;
  readonly now?: Date;
}

export type PlaceOrderOutcome =
  | {
      readonly kind: "placed";
      readonly orderId: string;
      readonly orderNumber: string;
      readonly paymentMethod: PaymentMethod;
      /** Set for guests: goes into the order-access cookie, never stored. */
      readonly guestToken: string | null;
      /** Online orders: the provider order to pay against, or null when creating it failed (retry on the pay page). */
      readonly providerOrderId: string | null;
    }
  | {
      /** The cart already has a live order (double submit, second tab): continue with it. */
      readonly kind: "resumed";
      readonly orderId: string;
      readonly orderNumber: string;
      readonly paymentMethod: PaymentMethod;
      readonly status: "PENDING_PAYMENT" | "CONFIRMED" | "NEEDS_REVIEW";
    }
  | { readonly kind: "quote_changed"; readonly quote: Quote }
  | { readonly kind: "not_purchasable"; readonly variantIds: readonly string[] }
  | { readonly kind: "refused"; readonly problem: QuoteProblem };

/** What the checkout page needs to render totals and choices. */
export interface CheckoutView {
  readonly cartId: string;
  readonly cart: CartView;
  readonly lines: readonly CartLineView[];
  readonly quotes: Readonly<Record<CheckoutPaymentMethod, Quote>>;
  readonly codRefusal: CodRefusal | null;
  readonly belowMinimum: boolean;
  readonly addresses: readonly AddressRow[];
}
