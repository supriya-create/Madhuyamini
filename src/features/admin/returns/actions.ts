"use server";

import { redirect } from "next/navigation";

import { parseForm, pickFormValues } from "@/features/auth/form-data";
import type { FormState } from "@/features/auth/schemas";
import { routes } from "@/lib/routes";

import { runAdminAction } from "../orders/action-support";
import {
  approveReturnSchema,
  inspectReturnSchema,
  receiveReturnSchema,
  rejectReturnSchema,
  requestInfoSchema,
  returnIdSchema,
  staffShipmentSchema,
} from "./schemas";
import {
  approveReturn,
  inspectReturn,
  receiveReturn,
  recordShipmentByStaff,
  rejectReturn,
  requestInformation,
} from "./service";

/** Admin return Server Actions (docs/phase-8-returns-custom-artwork.md §11.2). */

function returnIdFrom(formData: FormData): string {
  const parsed = returnIdSchema.safeParse(formData.get("returnId"));
  if (!parsed.success) redirect(routes.adminReturns);
  return parsed.data;
}

/** Per-line numbers arrive as `<field>:<returnItemId>`. */
function perItem(
  formData: FormData,
  field: string,
): Array<{ returnItemId: string; value: FormDataEntryValue }> {
  const rows: Array<{ returnItemId: string; value: FormDataEntryValue }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith(`${field}:`)) continue;
    rows.push({ returnItemId: key.slice(field.length + 1), value });
  }
  return rows;
}

export async function requestInfoAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const returnId = returnIdFrom(formData);
  const parsed = parseForm(
    requestInfoSchema,
    pickFormValues(formData, ["returnId", "message"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminReturn(returnId), async (ctx) => {
    await requestInformation(ctx, returnId, parsed.data.message);
    return "info_requested";
  });
}

export async function approveReturnAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const returnId = returnIdFrom(formData);
  const parsed = parseForm(approveReturnSchema, {
    returnId,
    instructions: formData.get("instructions"),
    note: formData.get("note") ?? "",
    items: perItem(formData, "approved").map((row) => ({
      returnItemId: row.returnItemId,
      approvedQty: row.value,
    })),
  });
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminReturn(returnId), async (ctx) => {
    await approveReturn(ctx, returnId, {
      instructions: parsed.data.instructions,
      note: parsed.data.note,
      items: parsed.data.items,
    });
    return "approved";
  });
}

export async function rejectReturnAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const returnId = returnIdFrom(formData);
  const parsed = parseForm(
    rejectReturnSchema,
    pickFormValues(formData, ["returnId", "reason"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminReturn(returnId), async (ctx) => {
    await rejectReturn(ctx, returnId, parsed.data.reason);
    return "rejected";
  });
}

export async function recordStaffShipmentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const returnId = returnIdFrom(formData);
  const parsed = parseForm(
    staffShipmentSchema,
    pickFormValues(formData, [
      "returnId",
      "carrier",
      "trackingNumber",
      "trackingUrl",
    ]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminReturn(returnId), async (ctx) => {
    await recordShipmentByStaff(ctx, returnId, {
      carrier: parsed.data.carrier,
      trackingNumber: parsed.data.trackingNumber || null,
      trackingUrl: parsed.data.trackingUrl || null,
    });
    return "shipment_recorded";
  });
}

export async function receiveReturnAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const returnId = returnIdFrom(formData);
  const parsed = parseForm(receiveReturnSchema, {
    returnId,
    note: formData.get("note"),
    items: perItem(formData, "received").map((row) => ({
      returnItemId: row.returnItemId,
      receivedQty: row.value,
    })),
  });
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminReturn(returnId), async (ctx) => {
    await receiveReturn(ctx, returnId, {
      note: parsed.data.note,
      items: parsed.data.items,
    });
    return "received";
  });
}

export async function inspectReturnAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const returnId = returnIdFrom(formData);
  const parsed = parseForm(inspectReturnSchema, {
    returnId,
    note: formData.get("note"),
    items: perItem(formData, "condition").map((row) => {
      const id = row.returnItemId;
      return {
        returnItemId: id,
        condition: row.value,
        restockQty: formData.get(`restock:${id}`) ?? "0",
        repairQty: formData.get(`repair:${id}`) ?? "0",
        quarantineQty: formData.get(`quarantine:${id}`) ?? "0",
        writeOffQty: formData.get(`writeoff:${id}`) ?? "0",
        returnToCustomerQty: formData.get(`tocustomer:${id}`) ?? "0",
        note: formData.get(`itemnote:${id}`) ?? "",
      };
    }),
  });
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminReturn(returnId), async (ctx) => {
    await inspectReturn(ctx, returnId, {
      note: parsed.data.note,
      items: parsed.data.items,
    });
    return "inspected";
  });
}
