"use server";

import { redirect } from "next/navigation";

import { parseForm, pickFormValues } from "@/features/auth/form-data";
import type { FormState } from "@/features/auth/schemas";
import { routes } from "@/lib/routes";

import {
  orderIdFrom,
  runAdminAction,
  runOrderAction,
} from "../orders/action-support";
import {
  acceptMismatchSchema,
  attachPaymentSchema,
  createRefundSchema,
  externalRefundSchema,
  refundIdSchema,
  retryRefundSchema,
} from "./schemas";
import {
  acceptMismatch,
  attachProviderPayment,
  createRefund,
  markRefundedExternally,
  recheckWithProvider,
  retryRefund,
} from "./service";

/** Payment review and refund Server Actions (docs/admin.md §5.5). */

export async function recheckWithProviderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = orderIdFrom(formData);
  return runOrderAction(orderId, async (ctx) => {
    await recheckWithProvider(ctx, orderId);
    return "rechecked";
  });
}

export async function attachPaymentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = orderIdFrom(formData);
  const parsed = parseForm(
    attachPaymentSchema,
    pickFormValues(formData, ["orderId", "providerPaymentId", "reason"]),
  );
  if (!parsed.ok) return parsed.state;
  return runOrderAction(orderId, async (ctx) => {
    await attachProviderPayment(ctx, orderId, {
      providerPaymentId: parsed.data.providerPaymentId,
      reason: parsed.data.reason,
    });
    return "attached";
  });
}

export async function acceptMismatchAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = orderIdFrom(formData);
  const parsed = parseForm(
    acceptMismatchSchema,
    pickFormValues(formData, ["orderId", "reason", "confirmOrderNumber"]),
  );
  if (!parsed.ok) return parsed.state;
  return runOrderAction(orderId, async (ctx) => {
    await acceptMismatch(ctx, orderId, {
      reason: parsed.data.reason,
      confirmOrderNumber: parsed.data.confirmOrderNumber,
    });
    return "accepted";
  });
}

export async function createRefundAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = orderIdFrom(formData);
  const parsed = parseForm(
    createRefundSchema,
    pickFormValues(formData, ["orderId", "amount", "reason", "operationKey"]),
  );
  if (!parsed.ok) return parsed.state;
  return runOrderAction(orderId, async (ctx) => {
    const { reused } = await createRefund(ctx, orderId, {
      amountInPaise: parsed.data.amount,
      reason: parsed.data.reason,
      operationKey: parsed.data.operationKey,
    });
    return reused ? "refund_exists" : "refund_queued";
  });
}

function refundIdFrom(formData: FormData): string {
  const parsed = refundIdSchema.safeParse(formData.get("refundId"));
  if (!parsed.success) redirect(routes.adminRefunds);
  return parsed.data;
}

export async function retryRefundAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const refundId = refundIdFrom(formData);
  const parsed = parseForm(
    retryRefundSchema,
    pickFormValues(formData, ["refundId", "reason"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminRefunds, async (ctx) => {
    await retryRefund(ctx, refundId, parsed.data.reason);
    return "retried";
  });
}

export async function markRefundedExternallyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const refundId = refundIdFrom(formData);
  const parsed = parseForm(
    externalRefundSchema,
    pickFormValues(formData, ["refundId", "providerRefundId", "reason"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminRefunds, async (ctx) => {
    await markRefundedExternally(ctx, refundId, {
      providerRefundId: parsed.data.providerRefundId,
      reason: parsed.data.reason,
    });
    return "external";
  });
}
