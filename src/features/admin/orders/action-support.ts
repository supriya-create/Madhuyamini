import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/features/auth/schemas";
import { requireStaffSession } from "@/server/auth/staff";
import type { StaffContext } from "@/server/auth/staff";
import { isAppError } from "@/server/errors";
import { routes } from "@/lib/routes";

import { ReauthRequiredError } from "../authz";
import { orderIdSchema } from "./schemas";

/**
 * Shared by the order and payment Server Actions: resolve the staff
 * context, run the service, and come back to the order page with a notice;
 * a sensitive action that needs a fresh second factor goes to re-auth.
 */

export type OrderNotice =
  | "processing"
  | "shipped"
  | "delivered"
  | "note"
  | "cancelled"
  | "delivery_failed"
  | "returned"
  | "inspected"
  | "carrier_lost"
  | "cod_collected"
  | "cod_reversed"
  | "rechecked"
  | "attached"
  | "accepted"
  | "refund_queued";

export const ORDER_NOTICES: Readonly<Record<OrderNotice, string>> = {
  processing: "The order is marked as being prepared.",
  shipped: "Shipment recorded; the customer has been emailed.",
  delivered: "Marked as delivered; the customer has been emailed.",
  note: "Note added.",
  cancelled: "The order has been cancelled.",
  delivery_failed:
    "Delivery failure recorded. The parcel is returning to origin.",
  returned: "Parcel recorded as received. Inspect it to close the order.",
  inspected: "Inspection recorded, stock adjusted and the order closed.",
  carrier_lost: "Closed as lost in transit.",
  cod_collected: "Cash collection recorded.",
  cod_reversed: "Cash collection reversed.",
  rechecked: "The provider was asked again; the payments below are current.",
  attached: "The provider payment was applied; see the payments below.",
  accepted: "Payment accepted and the order confirmed.",
  refund_queued:
    "Refund queued; the refund job will request it from the provider.",
};

const GENERIC = "That did not work. Please try again.";

export async function runOrderAction(
  orderId: string,
  work: (ctx: StaffContext) => Promise<OrderNotice>,
): Promise<FormState> {
  const ctx = await requireStaffSession();
  let notice: OrderNotice;
  try {
    notice = await work(ctx);
  } catch (error) {
    if (error instanceof ReauthRequiredError) {
      redirect(
        `${routes.adminReauth}?next=${encodeURIComponent(routes.adminOrder(orderId))}`,
      );
    }
    return {
      status: "error",
      message: isAppError(error) ? error.message : GENERIC,
    };
  }
  revalidatePath(routes.adminOrder(orderId));
  revalidatePath(routes.adminOrders);
  redirect(`${routes.adminOrder(orderId)}?notice=${notice}`);
}

export function orderIdFrom(formData: FormData): string {
  const parsed = orderIdSchema.safeParse(formData.get("orderId"));
  if (!parsed.success) redirect(routes.adminOrders);
  return parsed.data;
}

/** The same shape for pages that are not an order (the refunds queue). */
export async function runAdminAction(
  returnTo: string,
  work: (ctx: StaffContext) => Promise<string>,
): Promise<FormState> {
  const ctx = await requireStaffSession();
  let notice: string;
  try {
    notice = await work(ctx);
  } catch (error) {
    if (error instanceof ReauthRequiredError) {
      redirect(`${routes.adminReauth}?next=${encodeURIComponent(returnTo)}`);
    }
    return {
      status: "error",
      message: isAppError(error) ? error.message : GENERIC,
    };
  }
  revalidatePath(returnTo);
  redirect(`${returnTo}?notice=${encodeURIComponent(notice)}`);
}
