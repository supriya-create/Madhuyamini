"use server";

import { redirect } from "next/navigation";

import { parseForm, pickFormValues } from "@/features/auth/form-data";
import type { FormState } from "@/features/auth/schemas";
import { routes } from "@/lib/routes";

import { runAdminAction } from "../orders/action-support";
import {
  grantIdSchema,
  grantSchema,
  resetTwoFactorSchema,
  revealSchema,
  setRoleSchema,
  userIdOnlySchema,
  userIdSchema,
} from "./schemas";
import {
  issueGrant,
  resendVerification,
  resetStaffTwoFactor,
  revealCustomer,
  revokeGrant,
  setRole,
} from "./service";

/** Customer Server Actions (docs/admin.md §5.7). */

/** Checkbox groups arrive as repeated fields; the schema wants one CSV string. */
function withGroup(formData: FormData, group: string): FormData {
  const copy = new FormData();
  for (const [key, value] of formData.entries()) {
    if (key === group) continue;
    copy.append(key, value);
  }
  copy.set(group, formData.getAll(group).map(String).join(","));
  return copy;
}

function customerIdFrom(formData: FormData): string {
  const parsed = userIdSchema.safeParse(
    formData.get("customerId") ?? formData.get("userId"),
  );
  if (!parsed.success) redirect(routes.adminCustomers);
  return parsed.data;
}

export async function revealCustomerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const customerId = customerIdFrom(formData);
  const parsed = parseForm(
    revealSchema,
    pickFormValues(withGroup(formData, "fields"), [
      "customerId",
      "fields",
      "reason",
    ]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminCustomer(customerId), async (ctx) => {
    await revealCustomer(ctx, customerId, {
      fields: parsed.data.fields,
      reason: parsed.data.reason,
    });
    return "revealed";
  });
}

export async function issueGrantAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(
    grantSchema,
    pickFormValues(withGroup(formData, "fields"), [
      "granteeId",
      "customerId",
      "fields",
      "hours",
      "reason",
    ]),
  );
  if (!parsed.ok) return parsed.state;
  const returnTo = parsed.data.customerId
    ? routes.adminCustomer(parsed.data.customerId)
    : routes.adminCustomers;
  return runAdminAction(returnTo, async (ctx) => {
    await issueGrant(ctx, {
      granteeId: parsed.data.granteeId,
      customerId: parsed.data.customerId,
      fields: parsed.data.fields,
      hours: parsed.data.hours,
      reason: parsed.data.reason,
    });
    return "granted";
  });
}

export async function revokeGrantAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(
    grantIdSchema,
    pickFormValues(formData, ["grantId"]),
  );
  if (!parsed.ok) return parsed.state;
  const customerId = userIdSchema.safeParse(formData.get("customerId"));
  const returnTo = customerId.success
    ? routes.adminCustomer(customerId.data)
    : routes.adminCustomers;
  return runAdminAction(returnTo, async (ctx) => {
    await revokeGrant(
      ctx,
      parsed.data.grantId,
      "Revoked from the customer page.",
    );
    return "revoked";
  });
}

export async function setRoleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = customerIdFrom(formData);
  const parsed = parseForm(
    setRoleSchema,
    pickFormValues(formData, ["userId", "role", "reason", "confirmEmail"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminCustomer(userId), async (ctx) => {
    await setRole(ctx, userId, {
      role: parsed.data.role,
      reason: parsed.data.reason,
      confirmEmail: parsed.data.confirmEmail,
    });
    return "role";
  });
}

export async function resetTwoFactorAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = customerIdFrom(formData);
  const parsed = parseForm(
    resetTwoFactorSchema,
    pickFormValues(formData, ["userId", "reason"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminCustomer(userId), async (ctx) => {
    await resetStaffTwoFactor(ctx, userId, parsed.data.reason);
    return "two_factor_reset";
  });
}

export async function resendVerificationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const userId = customerIdFrom(formData);
  const parsed = parseForm(
    userIdOnlySchema,
    pickFormValues(formData, ["userId"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminCustomer(userId), async (ctx) => {
    await resendVerification(ctx, userId);
    return "verification_sent";
  });
}
