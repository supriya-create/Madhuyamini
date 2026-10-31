"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parseForm, pickFormValues } from "@/features/auth/form-data";
import { safeReturnPath } from "@/features/auth/schemas";
import { wishlistToggleSchema } from "@/features/cart/schemas";
import { getCurrentUser } from "@/server/auth/current-user";
import { NotFoundError } from "@/server/errors";
import { routes } from "@/lib/routes";

import { toggleWishlist } from "./service";

/** Signed-in customers only (C3); guests are sent to sign in and brought back. */
export async function toggleWishlistAction(formData: FormData): Promise<void> {
  const parsed = parseForm(
    wishlistToggleSchema,
    pickFormValues(formData, ["productId", "returnTo"]),
  );
  if (!parsed.ok) return;
  const returnTo = safeReturnPath(parsed.data.returnTo, routes.accountWishlist);

  const user = await getCurrentUser();
  if (!user) redirect(`${routes.login}?next=${encodeURIComponent(returnTo)}`);

  try {
    await toggleWishlist(user, parsed.data.productId);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  revalidatePath(returnTo);
  revalidatePath(routes.accountWishlist);
}
