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
  attachUploadSchema,
  categoryIdSchema,
  categorySchema,
  createVariantSchema,
  deleteProductSchema,
  idSchema,
  imageIdOnlySchema,
  imageUrlSchema,
  moveImageSchema,
  optionsSchema,
  productIdOnlySchema,
  productSchema,
  updateImageSchema,
  updateVariantSchema,
  variantIdOnlySchema,
} from "./schemas";
import {
  addImageByUrl,
  archiveProduct,
  attachUploadedImage,
  createCategory,
  createProduct,
  createVariant,
  deleteCategory,
  deleteProduct,
  deleteVariant,
  issueUploadTicket,
  moveImage,
  publishProduct,
  removeImage,
  restoreToDraft,
  saveOptions,
  updateCategory,
  updateImage,
  updateProduct,
  updateVariant,
} from "./service";
import type { UploadTicket } from "./service";

/** Catalogue Server Actions (docs/admin.md §5.2). */

const PRODUCT_FIELDS = [
  "title",
  "slug",
  "subtitle",
  "description",
  "techniques",
  "constructionMethods",
  "material",
  "careInstructions",
  "categoryId",
  "isFeatured",
  "isOneOfAKind",
  "metaTitle",
  "metaDescription",
  "hsnCode",
  "taxRateBp",
] as const;

/** Checkbox groups arrive as repeated fields; the schema wants one CSV string. */
function withGroups(formData: FormData, groups: readonly string[]): FormData {
  const copy = new FormData();
  for (const [key, value] of formData.entries()) {
    if (groups.includes(key)) continue;
    copy.append(key, value);
  }
  for (const group of groups) {
    copy.set(group, formData.getAll(group).map(String).join(","));
  }
  return copy;
}

function productIdFrom(formData: FormData): string {
  const parsed = idSchema.safeParse(formData.get("productId"));
  if (!parsed.success) redirect(routes.adminProducts);
  return parsed.data;
}

export async function createProductAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(
    productSchema,
    pickFormValues(
      withGroups(formData, ["techniques", "constructionMethods"]),
      PRODUCT_FIELDS,
    ),
  );
  if (!parsed.ok) return parsed.state;
  const ctx = await requireStaffSession();
  let id: string;
  try {
    ({ id } = await createProduct(ctx, parsed.data));
  } catch (error) {
    if (error instanceof ReauthRequiredError)
      redirect(
        `${routes.adminReauth}?next=${encodeURIComponent(routes.adminProductNew)}`,
      );
    return {
      status: "error",
      message: isAppError(error) ? error.message : "That did not work.",
    };
  }
  revalidatePath(routes.adminProducts);
  redirect(`${routes.adminProduct(id)}?notice=created`);
}

export async function updateProductAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const productId = productIdFrom(formData);
  const parsed = parseForm(
    productSchema,
    pickFormValues(
      withGroups(formData, ["techniques", "constructionMethods"]),
      PRODUCT_FIELDS,
    ),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminProduct(productId), async (ctx) => {
    await updateProduct(ctx, productId, parsed.data);
    return "saved";
  });
}

function productStatusAction(
  notice: string,
  work: (
    ctx: Parameters<Parameters<typeof runAdminAction>[1]>[0],
    productId: string,
  ) => Promise<void>,
) {
  return async (_prev: FormState, formData: FormData): Promise<FormState> => {
    const parsed = parseForm(
      productIdOnlySchema,
      pickFormValues(formData, ["productId"]),
    );
    if (!parsed.ok) return parsed.state;
    const { productId } = parsed.data;
    return runAdminAction(routes.adminProduct(productId), async (ctx) => {
      await work(ctx, productId);
      return notice;
    });
  };
}

export const publishProductAction = productStatusAction(
  "published",
  (ctx, id) => publishProduct(ctx, id),
);
export const archiveProductAction = productStatusAction("archived", (ctx, id) =>
  archiveProduct(ctx, id),
);
export const restoreProductAction = productStatusAction("restored", (ctx, id) =>
  restoreToDraft(ctx, id),
);

export async function deleteProductAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(
    deleteProductSchema,
    pickFormValues(formData, ["productId", "confirmSlug"]),
  );
  if (!parsed.ok) return parsed.state;
  const ctx = await requireStaffSession();
  try {
    await deleteProduct(ctx, parsed.data.productId, parsed.data.confirmSlug);
  } catch (error) {
    if (error instanceof ReauthRequiredError) {
      redirect(
        `${routes.adminReauth}?next=${encodeURIComponent(routes.adminProduct(parsed.data.productId))}`,
      );
    }
    return {
      status: "error",
      message: isAppError(error) ? error.message : "That did not work.",
    };
  }
  revalidatePath(routes.adminProducts);
  redirect(`${routes.adminProducts}?notice=deleted`);
}

export async function saveOptionsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const productId = productIdFrom(formData);
  const parsed = parseForm(
    optionsSchema,
    pickFormValues(formData, ["productId", "options"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminProduct(productId), async (ctx) => {
    await saveOptions(ctx, productId, parsed.data.options);
    return "options";
  });
}

const VARIANT_FIELDS = [
  "sku",
  "price",
  "compareAt",
  "weightGrams",
  "isActive",
  "optionValueIds",
] as const;

export async function createVariantAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const productId = productIdFrom(formData);
  const parsed = parseForm(
    createVariantSchema,
    pickFormValues(withGroups(formData, ["optionValueIds"]), [
      "productId",
      ...VARIANT_FIELDS,
      "initialStock",
      "lowStockThreshold",
    ]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminProduct(productId), async (ctx) => {
    await createVariant(ctx, productId, {
      sku: parsed.data.sku,
      priceInPaise: parsed.data.price,
      compareAtPriceInPaise: parsed.data.compareAt,
      weightGrams: parsed.data.weightGrams,
      isActive: parsed.data.isActive,
      optionValueIds: parsed.data.optionValueIds,
      initialStock: parsed.data.initialStock,
      lowStockThreshold: parsed.data.lowStockThreshold,
    });
    return "variant_created";
  });
}

export async function updateVariantAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const productId = productIdFrom(formData);
  const parsed = parseForm(
    updateVariantSchema,
    pickFormValues(withGroups(formData, ["optionValueIds"]), [
      "variantId",
      ...VARIANT_FIELDS,
    ]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminProduct(productId), async (ctx) => {
    await updateVariant(ctx, parsed.data.variantId, {
      sku: parsed.data.sku,
      priceInPaise: parsed.data.price,
      compareAtPriceInPaise: parsed.data.compareAt,
      weightGrams: parsed.data.weightGrams,
      isActive: parsed.data.isActive,
      optionValueIds: parsed.data.optionValueIds,
    });
    return "variant_saved";
  });
}

export async function deleteVariantAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const productId = productIdFrom(formData);
  const parsed = parseForm(
    variantIdOnlySchema,
    pickFormValues(formData, ["variantId"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminProduct(productId), async (ctx) => {
    await deleteVariant(ctx, parsed.data.variantId);
    return "variant_deleted";
  });
}

/** Called by the uploader before it talks to Cloudinary; returns the signed ticket. */
export async function issueUploadTicketAction(
  productId: string,
): Promise<
  { ok: true; ticket: UploadTicket } | { ok: false; message: string }
> {
  const parsed = idSchema.safeParse(productId);
  if (!parsed.success) return { ok: false, message: "Unknown product." };
  const ctx = await requireStaffSession();
  try {
    return { ok: true, ticket: await issueUploadTicket(ctx, parsed.data) };
  } catch (error) {
    return {
      ok: false,
      message: isAppError(error)
        ? error.message
        : "Could not start the upload.",
    };
  }
}

export async function attachUploadAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const productId = productIdFrom(formData);
  const parsed = parseForm(
    attachUploadSchema,
    pickFormValues(formData, [
      "productId",
      "publicId",
      "version",
      "signature",
      "format",
      "bytes",
      "width",
      "height",
      "resourceType",
      "alt",
    ]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminProduct(productId), async (ctx) => {
    await attachUploadedImage(ctx, productId, {
      publicId: parsed.data.publicId,
      version: parsed.data.version,
      signature: parsed.data.signature,
      format: parsed.data.format,
      bytes: parsed.data.bytes,
      width: parsed.data.width,
      height: parsed.data.height,
      resourceType: parsed.data.resourceType,
      alt: parsed.data.alt,
    });
    return "image_added";
  });
}

export async function addImageByUrlAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const productId = productIdFrom(formData);
  const parsed = parseForm(
    imageUrlSchema,
    pickFormValues(formData, ["productId", "url", "alt", "width", "height"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminProduct(productId), async (ctx) => {
    await addImageByUrl(ctx, productId, parsed.data);
    return "image_added";
  });
}

export async function updateImageAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const productId = productIdFrom(formData);
  const parsed = parseForm(
    updateImageSchema,
    pickFormValues(formData, ["imageId", "alt", "variantId"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminProduct(productId), async (ctx) => {
    await updateImage(ctx, parsed.data.imageId, {
      alt: parsed.data.alt,
      variantId: parsed.data.variantId,
    });
    return "image_saved";
  });
}

export async function moveImageAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const productId = productIdFrom(formData);
  const parsed = parseForm(
    moveImageSchema,
    pickFormValues(formData, ["imageId", "direction"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminProduct(productId), async (ctx) => {
    await moveImage(ctx, parsed.data.imageId, parsed.data.direction);
    return "image_saved";
  });
}

export async function removeImageAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const productId = productIdFrom(formData);
  const parsed = parseForm(
    imageIdOnlySchema,
    pickFormValues(formData, ["imageId"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminProduct(productId), async (ctx) => {
    await removeImage(ctx, parsed.data.imageId);
    return "image_removed";
  });
}

const CATEGORY_FIELDS = [
  "name",
  "slug",
  "description",
  "parentId",
  "position",
  "isActive",
] as const;

export async function createCategoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(
    categorySchema,
    pickFormValues(formData, CATEGORY_FIELDS),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminCategories, async (ctx) => {
    await createCategory(ctx, parsed.data);
    return "created";
  });
}

export async function updateCategoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = parseForm(
    categoryIdSchema,
    pickFormValues(formData, ["categoryId"]),
  );
  if (!id.ok) return id.state;
  const parsed = parseForm(
    categorySchema,
    pickFormValues(formData, CATEGORY_FIELDS),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminCategories, async (ctx) => {
    await updateCategory(ctx, id.data.categoryId, parsed.data);
    return "saved";
  });
}

export async function deleteCategoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(
    categoryIdSchema,
    pickFormValues(formData, ["categoryId"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(routes.adminCategories, async (ctx) => {
    await deleteCategory(ctx, parsed.data.categoryId);
    return "deleted";
  });
}
