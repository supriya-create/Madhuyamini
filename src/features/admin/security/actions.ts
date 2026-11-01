"use server";

import { redirect } from "next/navigation";

import { parseForm, pickFormValues } from "@/features/auth/form-data";
import type { FormState } from "@/features/auth/schemas";
import { safeReturnPath } from "@/features/auth/schemas";
import {
  getCurrentUser,
  requestClientAddress,
} from "@/server/auth/current-user";
import { isAppError } from "@/server/errors";
import { routes } from "@/lib/routes";

import {
  confirmEnrolmentSchema,
  recoveryCodeSchema,
  totpCodeSchema,
  verifySecondFactorSchema,
} from "./schemas";
import {
  beginEnrolment,
  confirmEnrolment,
  verifySecondFactor,
} from "./service";

/**
 * Second-factor Server Actions. They act on the signed-in user only; the
 * services decide what counts. Errors surface as form messages without
 * revealing which check failed beyond what the user needs.
 */

export interface TwoFactorFormState extends FormState {
  readonly recoveryCodes?: readonly string[];
}

const GENERIC = "That did not work. Please try again.";

function message(error: unknown): string {
  return isAppError(error) ? error.message : GENERIC;
}

export async function beginEnrolmentAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user)
    redirect(
      `${routes.login}?next=${encodeURIComponent(routes.accountTwoFactor)}`,
    );
  const next = safeReturnPath(formData.get("next"), routes.accountTwoFactor);
  try {
    await beginEnrolment(user);
  } catch (error) {
    redirect(
      `${routes.accountTwoFactor}?error=${encodeURIComponent(message(error))}`,
    );
  }
  redirect(`${routes.accountTwoFactor}?next=${encodeURIComponent(next)}`);
}

export async function confirmEnrolmentAction(
  _prev: TwoFactorFormState,
  formData: FormData,
): Promise<TwoFactorFormState> {
  const user = await getCurrentUser();
  if (!user)
    redirect(
      `${routes.login}?next=${encodeURIComponent(routes.accountTwoFactor)}`,
    );
  const parsed = parseForm(
    confirmEnrolmentSchema,
    pickFormValues(formData, ["code", "next"]),
  );
  if (!parsed.ok) return parsed.state;
  try {
    const { recoveryCodes } = await confirmEnrolment(user, parsed.data.code);
    return {
      status: "success",
      message:
        "Two-factor sign-in is on. Save these recovery codes now; they will not be shown again.",
      recoveryCodes,
    };
  } catch (error) {
    return { status: "error", message: message(error) };
  }
}

export async function verifySecondFactorAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user)
    redirect(`${routes.login}?next=${encodeURIComponent(routes.admin)}`);
  const parsed = parseForm(
    verifySecondFactorSchema,
    pickFormValues(formData, ["method", "code", "next"]),
  );
  if (!parsed.ok) return parsed.state;
  const next = safeReturnPath(parsed.data.next, routes.admin);
  const code =
    parsed.data.method === "totp"
      ? totpCodeSchema.safeParse(parsed.data.code)
      : recoveryCodeSchema.safeParse(parsed.data.code);
  if (!code.success) {
    return {
      status: "error",
      message: code.error.issues[0]?.message ?? "Enter the code",
      fieldErrors: { code: code.error.issues[0]?.message ?? "Enter the code" },
    };
  }
  try {
    await verifySecondFactor(
      user,
      { kind: parsed.data.method, code: code.data },
      { requestIp: await requestClientAddress() },
    );
  } catch (error) {
    if (isAppError(error) && error.code === "STAFF_NOT_ENROLLED") {
      redirect(`${routes.accountTwoFactor}?next=${encodeURIComponent(next)}`);
    }
    return { status: "error", message: message(error) };
  }
  redirect(next);
}
