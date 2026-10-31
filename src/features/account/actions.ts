"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  authErrorCode,
  authErrorMessage,
  isPasswordPolicyError,
} from "@/features/auth/errors";
import { parseForm, pickFormValues } from "@/features/auth/form-data";
import { changePasswordSchema } from "@/features/auth/schemas";
import type { FormState } from "@/features/auth/schemas";
import { requireUser } from "@/server/auth/current-user";
import { NotFoundError } from "@/server/errors";
import { routes } from "@/lib/routes";

import {
  addressIdSchema,
  addressSchema,
  profileSchema,
  sessionTokenSchema,
} from "./schemas";
import * as service from "./service";

/** Account Server Actions. Every one starts with `requireUser()`. */

const ADDRESS_FIELDS = [
  "label",
  "recipientName",
  "phone",
  "line1",
  "line2",
  "landmark",
  "city",
  "state",
  "postalCode",
  "isDefault",
] as const;

export async function updateProfileAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = parseForm(
    profileSchema,
    pickFormValues(formData, ["name", "phone"]),
  );
  if (!parsed.ok) return parsed.state;

  await service.saveProfile(user, parsed.data);
  revalidatePath(routes.account, "layout");
  return { status: "success", message: "Your details have been saved." };
}

export async function addAddressAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = parseForm(
    addressSchema,
    pickFormValues(formData, ADDRESS_FIELDS),
  );
  if (!parsed.ok) return parsed.state;

  try {
    await service.addAddress(user, parsed.data);
  } catch (error) {
    if (error instanceof service.AddressLimitError)
      return { status: "error", message: error.message };
    throw error;
  }
  revalidatePath(routes.accountAddresses);
  redirect(routes.accountAddresses);
}

export async function editAddressAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const id = addressIdSchema.safeParse(formData.get("id"));
  if (!id.success)
    return { status: "error", message: "That address could not be found." };
  const parsed = parseForm(
    addressSchema,
    pickFormValues(formData, ADDRESS_FIELDS),
  );
  if (!parsed.ok) return parsed.state;

  try {
    await service.editAddress(user, id.data, parsed.data);
  } catch (error) {
    if (error instanceof NotFoundError)
      return { status: "error", message: "That address could not be found." };
    throw error;
  }
  revalidatePath(routes.accountAddresses);
  redirect(routes.accountAddresses);
}

export async function deleteAddressAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = addressIdSchema.safeParse(formData.get("id"));
  if (id.success) {
    try {
      await service.removeAddress(user, id.data);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  revalidatePath(routes.accountAddresses);
}

export async function setDefaultAddressAction(
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const id = addressIdSchema.safeParse(formData.get("id"));
  if (id.success) {
    try {
      await service.makeDefaultAddress(user, id.data);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  revalidatePath(routes.accountAddresses);
}

export async function changePasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = parseForm(
    changePasswordSchema,
    pickFormValues(formData, ["currentPassword", "newPassword"]),
  );
  if (!parsed.ok) return parsed.state;

  try {
    await service.changePassword(
      user,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
  } catch (error) {
    if (isPasswordPolicyError(error)) {
      return {
        status: "error",
        message: "Please choose a different password.",
        fieldErrors: {
          newPassword:
            authErrorMessage(error) ?? "Please choose a different password.",
        },
      };
    }
    if (authErrorCode(error) === "INVALID_PASSWORD") {
      return {
        status: "error",
        message: "Your current password is not correct.",
        fieldErrors: {
          currentPassword: "Your current password is not correct.",
        },
      };
    }
    console.error("[account] change password failed", {
      code: authErrorCode(error),
    });
    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }

  // The session was rotated: a plain re-render would still carry the old
  // cookie, so send the browser to a fresh request with the new one.
  redirect(`${routes.accountSecurity}?changed=1`);
}

export async function revokeSessionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const token = sessionTokenSchema.safeParse(formData.get("token"));
  if (token.success && token.data !== user.session.token) {
    await service.revokeSession(token.data);
  }
  revalidatePath(routes.accountSecurity);
}

export async function revokeOtherSessionsAction(): Promise<void> {
  await requireUser();
  await service.revokeOtherSessions();
  revalidatePath(routes.accountSecurity);
}

export async function signOutEverywhereAction(): Promise<void> {
  await requireUser();
  await service.revokeAllSessions();
  redirect(routes.login);
}
