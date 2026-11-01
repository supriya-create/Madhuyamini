"use server";

import { parseForm, pickFormValues } from "@/features/auth/form-data";
import type { FormState } from "@/features/auth/schemas";

import { orderIdFrom, runOrderAction } from "./action-support";
import {
  cancelOrderSchema,
  carrierLossSchema,
  codCollectSchema,
  codReverseSchema,
  deliveryFailedSchema,
  inspectionSchema,
  parcelReturnedSchema,
  shipSchema,
  staffNoteSchema,
} from "./schemas";
import {
  addStaffNote,
  cancelOrder,
  collectCod,
  completeInspection,
  confirmCarrierLoss,
  markDelivered,
  markDeliveryFailed,
  markParcelReturned,
  reverseCodCollection,
  shipOrder,
  startProcessing,
} from "./service";

/**
 * Admin order Server Actions. Each one resolves the StaffContext from the
 * request, validates the form with Zod, calls the service (which authorises
 * and audits), and comes back to the order page with a notice. A sensitive
 * action that needs a fresh second factor sends the operator to re-auth.
 */

export async function startProcessingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = orderIdFrom(formData);
  return runOrderAction(orderId, async (ctx) => {
    await startProcessing(ctx, orderId);
    return "processing";
  });
}

export async function shipOrderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = orderIdFrom(formData);
  const parsed = parseForm(
    shipSchema,
    pickFormValues(formData, [
      "orderId",
      "carrier",
      "trackingNumber",
      "trackingUrl",
    ]),
  );
  if (!parsed.ok) return parsed.state;
  return runOrderAction(orderId, async (ctx) => {
    await shipOrder(ctx, orderId, {
      carrier: parsed.data.carrier,
      trackingNumber: parsed.data.trackingNumber || null,
      trackingUrl: parsed.data.trackingUrl || null,
    });
    return "shipped";
  });
}

export async function markDeliveredAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = orderIdFrom(formData);
  return runOrderAction(orderId, async (ctx) => {
    await markDelivered(ctx, orderId);
    return "delivered";
  });
}

export async function addStaffNoteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = orderIdFrom(formData);
  const parsed = parseForm(
    staffNoteSchema,
    pickFormValues(formData, ["orderId", "note"]),
  );
  if (!parsed.ok) return parsed.state;
  return runOrderAction(orderId, async (ctx) => {
    await addStaffNote(ctx, orderId, parsed.data.note);
    return "note";
  });
}

export async function cancelOrderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = orderIdFrom(formData);
  const parsed = parseForm(
    cancelOrderSchema,
    pickFormValues(formData, ["orderId", "reason", "confirmOrderNumber"]),
  );
  if (!parsed.ok) return parsed.state;
  return runOrderAction(orderId, async (ctx) => {
    await cancelOrder(ctx, orderId, {
      reason: parsed.data.reason,
      confirmOrderNumber: parsed.data.confirmOrderNumber,
    });
    return "cancelled";
  });
}

export async function markDeliveryFailedAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = orderIdFrom(formData);
  const parsed = parseForm(
    deliveryFailedSchema,
    pickFormValues(formData, ["orderId", "reason", "note"]),
  );
  if (!parsed.ok) return parsed.state;
  return runOrderAction(orderId, async (ctx) => {
    await markDeliveryFailed(ctx, orderId, {
      reason: parsed.data.reason,
      note: parsed.data.note || null,
    });
    return "delivery_failed";
  });
}

export async function markParcelReturnedAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = orderIdFrom(formData);
  const parsed = parseForm(
    parcelReturnedSchema,
    pickFormValues(formData, ["orderId", "note"]),
  );
  if (!parsed.ok) return parsed.state;
  return runOrderAction(orderId, async (ctx) => {
    await markParcelReturned(ctx, orderId, parsed.data.note);
    return "returned";
  });
}

export async function completeInspectionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = orderIdFrom(formData);
  // Per-line quantities arrive as restock:<itemId> and writeoff:<itemId>.
  const items: Array<{
    orderItemId: string;
    restockQty: unknown;
    writeOffQty: unknown;
  }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("restock:")) continue;
    const orderItemId = key.slice("restock:".length);
    items.push({
      orderItemId,
      restockQty: value,
      writeOffQty: formData.get(`writeoff:${orderItemId}`) ?? "0",
    });
  }
  const parsed = parseForm(inspectionSchema, {
    orderId,
    note: formData.get("note"),
    items,
  });
  if (!parsed.ok) return parsed.state;
  return runOrderAction(orderId, async (ctx) => {
    await completeInspection(ctx, orderId, {
      note: parsed.data.note,
      items: parsed.data.items,
    });
    return "inspected";
  });
}

export async function confirmCarrierLossAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = orderIdFrom(formData);
  const parsed = parseForm(
    carrierLossSchema,
    pickFormValues(formData, ["orderId", "claimReference", "reason"]),
  );
  if (!parsed.ok) return parsed.state;
  return runOrderAction(orderId, async (ctx) => {
    await confirmCarrierLoss(ctx, orderId, {
      claimReference: parsed.data.claimReference,
      reason: parsed.data.reason,
    });
    return "carrier_lost";
  });
}

export async function collectCodAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = orderIdFrom(formData);
  const parsed = parseForm(
    codCollectSchema,
    pickFormValues(formData, ["orderId", "amount", "reason"]),
  );
  if (!parsed.ok) return parsed.state;
  return runOrderAction(orderId, async (ctx) => {
    await collectCod(ctx, orderId, {
      amountInPaise: parsed.data.amount,
      reason: parsed.data.reason || null,
    });
    return "cod_collected";
  });
}

export async function reverseCodCollectionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = orderIdFrom(formData);
  const parsed = parseForm(
    codReverseSchema,
    pickFormValues(formData, ["orderId", "reason"]),
  );
  if (!parsed.ok) return parsed.state;
  return runOrderAction(orderId, async (ctx) => {
    await reverseCodCollection(ctx, orderId, parsed.data.reason);
    return "cod_reversed";
  });
}
