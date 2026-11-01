"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parseForm, pickFormValues } from "@/features/auth/form-data";
import type { FormState } from "@/features/auth/schemas";
import { requireStaffSession } from "@/server/auth/staff";
import { isAppError } from "@/server/errors";
import { routes } from "@/lib/routes";

import { ReauthRequiredError } from "../authz";
import { runAdminAction } from "../orders/action-support";
import {
  acknowledgeAlertSchema,
  discardNotificationSchema,
  reapplyWebhookSchema,
  retryNotificationSchema,
  runJobSchema,
} from "./schemas";
import {
  acknowledgeAlert,
  discardNotification,
  reapplyWebhook,
  retryNotification,
  runJobNow,
} from "./service";

/** Operations Server Actions (docs/admin.md §5.6). */

const view = (name: string) => `${routes.adminOperations}?view=${name}`;

export async function retryNotificationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(
    retryNotificationSchema,
    pickFormValues(formData, ["id"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(view("outbox"), async (ctx) => {
    await retryNotification(ctx, parsed.data.id);
    return "retried";
  });
}

export async function discardNotificationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(
    discardNotificationSchema,
    pickFormValues(formData, ["id", "reason"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(view("outbox"), async (ctx) => {
    await discardNotification(ctx, parsed.data.id, parsed.data.reason);
    return "discarded";
  });
}

export async function reapplyWebhookAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(
    reapplyWebhookSchema,
    pickFormValues(formData, ["id", "reason"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(view("webhooks"), async (ctx) => {
    await reapplyWebhook(ctx, parsed.data.id, parsed.data.reason);
    return "reapplied";
  });
}

export async function acknowledgeAlertAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(
    acknowledgeAlertSchema,
    pickFormValues(formData, ["id"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(view("alerts"), async (ctx) => {
    await acknowledgeAlert(ctx, parsed.data.id);
    return "acknowledged";
  });
}

/** Runs in the request and shows the summary in place (no redirect). */
export async function runJobAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(runJobSchema, pickFormValues(formData, ["name"]));
  if (!parsed.ok) return parsed.state;
  const ctx = await requireStaffSession();
  try {
    const summary = await runJobNow(ctx, parsed.data.name);
    revalidatePath(routes.adminOperations);
    const parts = Object.entries(summary)
      .filter(([key]) => key !== "durationMs")
      .map(([key, value]) => `${key} ${value}`)
      .join(", ");
    return {
      status: "success",
      message: `${parsed.data.name} ran in ${summary.durationMs ?? 0} ms: ${parts || "nothing to do"}.`,
    };
  } catch (error) {
    if (error instanceof ReauthRequiredError) {
      redirect(
        `${routes.adminReauth}?next=${encodeURIComponent(view("jobs"))}`,
      );
    }
    return {
      status: "error",
      message: isAppError(error)
        ? error.message
        : "The job failed; see the server logs.",
    };
  }
}
