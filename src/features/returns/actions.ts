"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parseForm, pickFormValues } from "@/features/auth/form-data";
import type { FormState } from "@/features/auth/schemas";
import { requestClientAddress, requireUser } from "@/server/auth/current-user";
import { isAppError } from "@/server/errors";
import {
  issueCustomerUploadTicket,
  verifyCustomerUpload,
} from "@/server/uploads/customer";
import type { CustomerUploadTicket } from "@/server/uploads/customer";
import { routes } from "@/lib/routes";

import { ineligibleMessages } from "./rules";
import {
  addEvidenceSchema,
  recordShipmentSchema,
  replyReturnSchema,
  submitReturnSchema,
  uploadFactsSchema,
  withdrawReturnSchema,
} from "./schemas";
import {
  ReturnIneligibleError,
  addReturnEvidence,
  recordReturnShipment,
  replyToReturnRequest,
  submitReturnRequest,
  withdrawReturnRequest,
} from "./service";

/** Customer return Server Actions. Every one starts with `requireUser()`. */

const GENERIC = "That did not work. Please try again.";

function failure(error: unknown): FormState {
  if (error instanceof ReturnIneligibleError) {
    return {
      status: "error",
      message: error.message,
      fieldErrors: Object.fromEntries(
        error.problems
          .filter((problem) => problem.orderItemId)
          .map((problem) => [
            `line:${problem.orderItemId}`,
            ineligibleMessages[problem.reason],
          ]),
      ),
    };
  }
  return {
    status: "error",
    message: isAppError(error) ? error.message : GENERIC,
  };
}

/** Lines arrive as `line:<orderItemId>:<field>` fields; only ticked lines are sent. */
function linesFrom(formData: FormData) {
  const lines = new Map<
    string,
    {
      orderItemId: string;
      quantity: unknown;
      reason: unknown;
      description: unknown;
      resolution: unknown;
      exchangeVariantId: unknown;
    }
  >();
  for (const [key, value] of formData.entries()) {
    const match =
      /^line:([0-9a-f-]{36}):(include|quantity|reason|description|resolution|exchangeVariantId)$/.exec(
        key,
      );
    if (!match) continue;
    const [, orderItemId = "", field = ""] = match;
    const line = lines.get(orderItemId) ?? {
      orderItemId,
      quantity: undefined,
      reason: undefined,
      description: "",
      resolution: "REFUND",
      exchangeVariantId: "",
    };
    if (field === "include") line.quantity ??= undefined;
    else if (field === "quantity") line.quantity = value;
    else if (field === "reason") line.reason = value;
    else if (field === "description") line.description = value;
    else if (field === "resolution") line.resolution = value;
    else if (field === "exchangeVariantId") line.exchangeVariantId = value;
    lines.set(orderItemId, line);
  }
  return [...lines.values()].filter((line) =>
    formData.has(`line:${line.orderItemId}:include`),
  );
}

export async function submitReturnRequestAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = parseForm(submitReturnSchema, {
    orderNumber: formData.get("orderNumber"),
    operationKey: formData.get("operationKey"),
    lines: linesFrom(formData),
    evidenceIds: formData.getAll("evidenceId"),
  });
  if (!parsed.ok) return parsed.state;
  let requestNumber: string;
  try {
    const result = await submitReturnRequest(
      user,
      parsed.data,
      await requestClientAddress(),
    );
    requestNumber = result.requestNumber;
  } catch (error) {
    return failure(error);
  }
  revalidatePath(routes.accountOrders, "layout");
  redirect(`${routes.accountReturn(requestNumber)}?notice=requested`);
}

export async function withdrawReturnAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = parseForm(
    withdrawReturnSchema,
    pickFormValues(formData, ["requestNumber"]),
  );
  if (!parsed.ok) return parsed.state;
  try {
    await withdrawReturnRequest(user, parsed.data.requestNumber);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(routes.accountReturns, "layout");
  redirect(
    `${routes.accountReturn(parsed.data.requestNumber)}?notice=withdrawn`,
  );
}

export async function replyToReturnAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = parseForm(
    replyReturnSchema,
    pickFormValues(formData, ["requestNumber", "body"]),
  );
  if (!parsed.ok) return parsed.state;
  try {
    await replyToReturnRequest(
      user,
      parsed.data.requestNumber,
      parsed.data.body,
    );
  } catch (error) {
    return failure(error);
  }
  revalidatePath(routes.accountReturn(parsed.data.requestNumber));
  return { status: "success", message: "Your message has been added." };
}

export async function recordReturnShipmentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = parseForm(
    recordShipmentSchema,
    pickFormValues(formData, [
      "requestNumber",
      "carrier",
      "trackingNumber",
      "trackingUrl",
    ]),
  );
  if (!parsed.ok) return parsed.state;
  try {
    await recordReturnShipment(user, parsed.data.requestNumber, {
      carrier: parsed.data.carrier,
      trackingNumber: parsed.data.trackingNumber || null,
      trackingUrl: parsed.data.trackingUrl || null,
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(routes.accountReturns, "layout");
  redirect(`${routes.accountReturn(parsed.data.requestNumber)}?notice=shipped`);
}

export async function addReturnEvidenceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = parseForm(addEvidenceSchema, {
    requestNumber: formData.get("requestNumber"),
    evidenceIds: formData.getAll("evidenceId"),
  });
  if (!parsed.ok) return parsed.state;
  try {
    await addReturnEvidence(
      user,
      parsed.data.requestNumber,
      parsed.data.evidenceIds,
    );
  } catch (error) {
    return failure(error);
  }
  revalidatePath(routes.accountReturn(parsed.data.requestNumber));
  return { status: "success", message: "Your photographs have been added." };
}

/** Starts a private evidence upload; the browser sends the file straight to Cloudinary. */
export async function issueEvidenceTicketAction(): Promise<
  { ok: true; ticket: CustomerUploadTicket } | { ok: false; message: string }
> {
  const user = await requireUser();
  try {
    return {
      ok: true,
      ticket: await issueCustomerUploadTicket(user, "RETURN_EVIDENCE"),
    };
  } catch (error) {
    return {
      ok: false,
      message: isAppError(error)
        ? error.message
        : "Could not start the upload.",
    };
  }
}

/** Confirms what Cloudinary returned; nothing is trusted until the signature checks out. */
export async function confirmEvidenceUploadAction(
  input: Record<string, unknown>,
): Promise<{ ok: true; uploadId: string } | { ok: false; message: string }> {
  const user = await requireUser();
  const parsed = uploadFactsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "The upload response was not understood." };
  }
  try {
    const { uploadId } = await verifyCustomerUpload(user, {
      uploadId: parsed.data.uploadId,
      publicId: parsed.data.publicId,
      version: parsed.data.version,
      signature: parsed.data.signature,
      format: parsed.data.format,
      bytes: parsed.data.bytes,
      width: parsed.data.width,
      height: parsed.data.height,
      resourceType: parsed.data.resourceType,
    });
    return { ok: true, uploadId };
  } catch (error) {
    return {
      ok: false,
      message: isAppError(error)
        ? error.message
        : "The upload could not be confirmed.",
    };
  }
}
