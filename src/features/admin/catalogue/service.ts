import "server-only";

import { randomBytes } from "node:crypto";

import { getAdminPolicy } from "@/config/admin-policy";
import type { Prisma } from "@/generated/prisma/client";
import { variantTitle } from "@/features/catalog/rules";
import { applyAdjustment } from "@/features/inventory/service";
import type { StaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { AppError, NotFoundError } from "@/server/errors";
import { destroyCloudinaryImage } from "@/server/uploads/cloudinary";
import {
  expectedResponseSignature,
  isWithinUploadFolder,
  signParams,
} from "@/server/uploads/signature";

import { runAudited } from "../audit";
import { findProductForEdit, listCategories, listProducts } from "./data";
import type {
  CategoryAdminRow,
  ProductEditRow,
  ProductListFilters,
  ProductListRow,
} from "./data";
import { slugify } from "./schemas";
import type { ProductInput } from "./schemas";

/**
 * Catalogue operations (docs/admin.md §5.2, §6 A1–A2). Archive rather than
 * delete (A3); uploads are signed per product, verified on return and kept
 * in a ledger (A4); every change is audited.
 */

type Tx = Prisma.TransactionClient;

export class CatalogueError extends AppError {
  constructor(message: string, code = "CATALOGUE_NOT_ALLOWED") {
    super(message, { code, status: 409 });
  }
}

const PRODUCT_SNAPSHOT_KEYS = [
  "id",
  "slug",
  "title",
  "status",
  "categoryId",
  "isFeatured",
  "isOneOfAKind",
] as const;

function productSnapshot(
  row: Pick<ProductEditRow, (typeof PRODUCT_SNAPSHOT_KEYS)[number]>,
) {
  return Object.fromEntries(
    PRODUCT_SNAPSHOT_KEYS.map((key) => [key, row[key]]),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ProductListItem {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly status: string;
  readonly categoryName: string;
  readonly variantCount: number;
  readonly activeVariantCount: number;
  readonly availableUnits: number;
  readonly image: { url: string; alt: string } | null;
  readonly isFeatured: boolean;
  readonly updatedAt: Date;
}

function toListItem(row: ProductListRow): ProductListItem {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    categoryName: row.category.name,
    variantCount: row.variants.length,
    activeVariantCount: row.variants.filter((v) => v.isActive).length,
    availableUnits: row.variants.reduce(
      (sum, v) =>
        sum + ((v.inventory?.stockOnHand ?? 0) - (v.inventory?.reserved ?? 0)),
      0,
    ),
    image: row.images[0] ?? null,
    isFeatured: row.isFeatured,
    updatedAt: row.updatedAt,
  };
}

export async function getProductList(
  ctx: StaffContext,
  filters: ProductListFilters,
): Promise<{
  items: ProductListItem[];
  total: number;
  page: number;
  pageCount: number;
}> {
  const result = await listProducts(ctx, filters);
  return { ...result, items: result.rows.map(toListItem) };
}

export async function getProductForEdit(
  ctx: StaffContext,
  productId: string,
): Promise<ProductEditRow | null> {
  return findProductForEdit(ctx, productId);
}

export async function getCategories(
  ctx: StaffContext,
): Promise<CategoryAdminRow[]> {
  return listCategories(ctx);
}

// ---------------------------------------------------------------------------
// Products (A1)
// ---------------------------------------------------------------------------

async function uniqueSlug(
  tx: Tx,
  wanted: string,
  excludeId: string | null,
): Promise<string> {
  let candidate = wanted;
  for (let suffix = 2; suffix < 50; suffix += 1) {
    const clash = await tx.product.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!clash || clash.id === excludeId) return candidate;
    candidate = `${wanted}-${suffix}`;
  }
  throw new CatalogueError(
    "Could not find a free slug; choose one by hand.",
    "SLUG_TAKEN",
  );
}

function productData(input: ProductInput) {
  return {
    title: input.title,
    subtitle: input.subtitle,
    description: input.description,
    techniques: input.techniques,
    constructionMethods: input.constructionMethods,
    material: input.material,
    careInstructions: input.careInstructions,
    categoryId: input.categoryId,
    isFeatured: input.isFeatured,
    isOneOfAKind: input.isOneOfAKind,
    metaTitle: input.metaTitle,
    metaDescription: input.metaDescription,
    hsnCode: input.hsnCode,
    taxRateBp: input.taxRateBp,
  };
}

export async function createProduct(
  ctx: StaffContext,
  input: ProductInput,
  now = new Date(),
): Promise<{ id: string }> {
  return runAudited(
    {
      ctx,
      action: "product.create",
      targetType: "product",
      capability: "catalogue.edit",
      now,
    },
    async (tx) => {
      const category = await tx.category.findUnique({
        where: { id: input.categoryId },
        select: { id: true },
      });
      if (!category)
        throw new CatalogueError(
          "Choose an existing category.",
          "CATEGORY_NOT_FOUND",
        );
      const slug = await uniqueSlug(
        tx,
        input.slug.trim().toLowerCase() || slugify(input.title),
        null,
      );
      const created = await tx.product.create({
        data: { ...productData(input), slug, status: "DRAFT" },
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          categoryId: true,
          isFeatured: true,
          isOneOfAKind: true,
        },
      });
      return {
        result: { id: created.id },
        targetId: created.id,
        after: productSnapshot(created),
      };
    },
  );
}

export async function updateProduct(
  ctx: StaffContext,
  productId: string,
  input: ProductInput,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "product.update",
      targetType: "product",
      targetId: productId,
      capability: "catalogue.edit",
      now,
    },
    async (tx) => {
      const before = await tx.product.findUnique({
        where: { id: productId },
        select: productEditSelectLite,
      });
      if (!before) throw new NotFoundError("Product");
      const category = await tx.category.findUnique({
        where: { id: input.categoryId },
        select: { id: true },
      });
      if (!category)
        throw new CatalogueError(
          "Choose an existing category.",
          "CATEGORY_NOT_FOUND",
        );
      const slug = await uniqueSlug(
        tx,
        input.slug.trim().toLowerCase() || slugify(input.title),
        productId,
      );
      const after = await tx.product.update({
        where: { id: productId },
        data: { ...productData(input), slug },
        select: productEditSelectLite,
      });
      return {
        result: undefined,
        before: productSnapshot(before),
        after: productSnapshot(after),
      };
    },
  );
}

const productEditSelectLite = {
  id: true,
  slug: true,
  title: true,
  status: true,
  categoryId: true,
  isFeatured: true,
  isOneOfAKind: true,
} satisfies Prisma.ProductSelect;

/** DRAFT → ACTIVE needs something to sell and something to show (§5.2). */
export async function publishProduct(
  ctx: StaffContext,
  productId: string,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "product.publish",
      targetType: "product",
      targetId: productId,
      capability: "catalogue.publish",
      now,
    },
    async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: {
          ...productEditSelectLite,
          publishedAt: true,
          variants: { select: { isActive: true, priceInPaise: true } },
          images: { select: { alt: true } },
        },
      });
      if (!product) throw new NotFoundError("Product");
      if (product.status === "ACTIVE")
        throw new CatalogueError("Already published.");
      if (!product.variants.some((v) => v.isActive && v.priceInPaise > 0)) {
        throw new CatalogueError(
          "Add at least one active variant with a price before publishing.",
          "NO_SELLABLE_VARIANT",
        );
      }
      if (!product.images.some((image) => image.alt.trim().length > 0)) {
        throw new CatalogueError(
          "Add at least one image with a description before publishing.",
          "NO_IMAGE",
        );
      }
      const after = await tx.product.update({
        where: { id: productId },
        data: { status: "ACTIVE", publishedAt: product.publishedAt ?? now },
        select: productEditSelectLite,
      });
      return {
        result: undefined,
        before: productSnapshot(product),
        after: productSnapshot(after),
      };
    },
  );
}

export async function archiveProduct(
  ctx: StaffContext,
  productId: string,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "product.archive",
      targetType: "product",
      targetId: productId,
      capability: "catalogue.publish",
      now,
    },
    async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: productEditSelectLite,
      });
      if (!product) throw new NotFoundError("Product");
      if (product.status === "ARCHIVED")
        throw new CatalogueError("Already archived.");
      const after = await tx.product.update({
        where: { id: productId },
        data: { status: "ARCHIVED" },
        select: productEditSelectLite,
      });
      return {
        result: undefined,
        before: productSnapshot(product),
        after: productSnapshot(after),
      };
    },
  );
}

export async function restoreToDraft(
  ctx: StaffContext,
  productId: string,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "product.restore",
      targetType: "product",
      targetId: productId,
      capability: "catalogue.publish",
      now,
    },
    async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: productEditSelectLite,
      });
      if (!product) throw new NotFoundError("Product");
      if (product.status !== "ARCHIVED")
        throw new CatalogueError("Only archived products go back to draft.");
      const after = await tx.product.update({
        where: { id: productId },
        data: { status: "DRAFT" },
        select: productEditSelectLite,
      });
      return {
        result: undefined,
        before: productSnapshot(product),
        after: productSnapshot(after),
      };
    },
  );
}

/** Hard delete only when nothing references the product (A3); otherwise archive. */
export async function deleteProduct(
  ctx: StaffContext,
  productId: string,
  confirmSlug: string,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "product.delete",
      targetType: "product",
      targetId: productId,
      capability: "catalogue.delete",
      now,
    },
    async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: {
          ...productEditSelectLite,
          _count: { select: { wishlistItems: true } },
          variants: {
            select: {
              _count: {
                select: {
                  orderItems: true,
                  cartItems: true,
                  adjustments: true,
                },
              },
            },
          },
          images: { select: { publicId: true } },
        },
      });
      if (!product) throw new NotFoundError("Product");
      if (product.slug !== confirmSlug.trim().toLowerCase()) {
        throw new CatalogueError(
          "The slug you typed does not match.",
          "CONFIRMATION_MISMATCH",
        );
      }
      const referenced =
        product._count.wishlistItems > 0 ||
        product.variants.some(
          (v) =>
            v._count.orderItems > 0 ||
            v._count.cartItems > 0 ||
            v._count.adjustments > 0,
        );
      if (referenced || product.status === "ACTIVE") {
        throw new CatalogueError(
          "This product is live, or has orders, carts, wishlists or stock movements pointing at it: archive it instead.",
          "PRODUCT_REFERENCED",
        );
      }
      await tx.productImageUpload.updateMany({
        where: { productId, status: { in: ["ISSUED", "ATTACHED"] } },
        data: {
          status: "DISCARDED",
          resolvedAt: now,
          sweepError: "Product deleted; asset not yet removed.",
        },
      });
      await tx.product.delete({ where: { id: productId } });
      return { result: undefined, before: productSnapshot(product) };
    },
  );
}

// ---------------------------------------------------------------------------
// Options and variants
// ---------------------------------------------------------------------------

export async function saveOptions(
  ctx: StaffContext,
  productId: string,
  options: ReadonlyArray<{ name: string; values: readonly string[] }>,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "product.options",
      targetType: "product",
      targetId: productId,
      capability: "catalogue.edit",
      now,
    },
    async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: {
          ...productEditSelectLite,
          options: {
            select: {
              id: true,
              name: true,
              values: { select: { id: true, value: true } },
            },
          },
        },
      });
      if (!product) throw new NotFoundError("Product");
      const keep = new Set(options.map((o) => o.name.toLowerCase()));
      for (const existing of product.options) {
        if (keep.has(existing.name.toLowerCase())) continue;
        const used = await tx.productVariantValue.count({
          where: { optionId: existing.id },
        });
        if (used > 0) {
          throw new CatalogueError(
            `Option "${existing.name}" is used by variants; deactivate or delete those variants first.`,
            "OPTION_IN_USE",
          );
        }
        await tx.productOption.delete({ where: { id: existing.id } });
      }
      for (const [position, option] of options.entries()) {
        const existing = product.options.find(
          (o) => o.name.toLowerCase() === option.name.toLowerCase(),
        );
        const row = existing
          ? await tx.productOption.update({
              where: { id: existing.id },
              data: { name: option.name, position },
              select: { id: true },
            })
          : await tx.productOption.create({
              data: { productId, name: option.name, position },
              select: { id: true },
            });
        const keepValues = new Set(option.values.map((v) => v.toLowerCase()));
        for (const value of existing?.values ?? []) {
          if (keepValues.has(value.value.toLowerCase())) continue;
          const used = await tx.productVariantValue.count({
            where: { optionValueId: value.id },
          });
          if (used > 0) {
            throw new CatalogueError(
              `Value "${value.value}" of "${option.name}" is used by a variant.`,
              "OPTION_VALUE_IN_USE",
            );
          }
          await tx.productOptionValue.delete({ where: { id: value.id } });
        }
        for (const [valuePosition, value] of option.values.entries()) {
          const existingValue = existing?.values.find(
            (v) => v.value.toLowerCase() === value.toLowerCase(),
          );
          if (existingValue) {
            await tx.productOptionValue.update({
              where: { id: existingValue.id },
              data: { value, position: valuePosition },
            });
          } else {
            await tx.productOptionValue.create({
              data: { optionId: row.id, value, position: valuePosition },
            });
          }
        }
      }
      return {
        result: undefined,
        before: productSnapshot(product),
        after: {
          ...productSnapshot(product),
          options: options
            .map((o) => `${o.name}: ${o.values.join(", ")}`)
            .join("; "),
        },
      };
    },
  );
}

export interface VariantInput {
  readonly sku: string;
  readonly priceInPaise: number;
  readonly compareAtPriceInPaise: number | null;
  readonly weightGrams: number | null;
  readonly isActive: boolean;
  readonly optionValueIds: readonly string[];
}

async function resolveOptionValues(
  tx: Tx,
  productId: string,
  optionValueIds: readonly string[],
) {
  const options = await tx.productOption.findMany({
    where: { productId },
    select: {
      id: true,
      name: true,
      values: { select: { id: true, value: true } },
    },
    orderBy: { position: "asc" },
  });
  const chosen: Array<{
    optionId: string;
    optionValueId: string;
    value: string;
  }> = [];
  for (const option of options) {
    const picked = option.values.filter((v) => optionValueIds.includes(v.id));
    if (picked.length !== 1) {
      throw new CatalogueError(
        `Choose exactly one value for "${option.name}".`,
        "OPTION_VALUE_REQUIRED",
      );
    }
    const value = picked[0];
    if (!value) continue;
    chosen.push({
      optionId: option.id,
      optionValueId: value.id,
      value: value.value,
    });
  }
  return chosen;
}

function variantSnapshot(row: {
  id: string;
  sku: string;
  priceInPaise: number;
  compareAtPriceInPaise: number | null;
  isActive: boolean;
}) {
  return {
    id: row.id,
    sku: row.sku,
    priceInPaise: row.priceInPaise,
    compareAtPriceInPaise: row.compareAtPriceInPaise,
    isActive: row.isActive,
  };
}

export async function createVariant(
  ctx: StaffContext,
  productId: string,
  input: VariantInput & {
    readonly initialStock: number;
    readonly lowStockThreshold: number;
  },
  now = new Date(),
): Promise<{ id: string }> {
  return runAudited(
    {
      ctx,
      action: "variant.create",
      targetType: "variant",
      capability: "catalogue.edit",
      now,
    },
    async (tx, audit) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          isOneOfAKind: true,
          _count: { select: { variants: true } },
        },
      });
      if (!product) throw new NotFoundError("Product");
      if (product.isOneOfAKind && product._count.variants >= 1) {
        throw new CatalogueError(
          "A one-of-a-kind piece has a single variant.",
          "ONE_OF_A_KIND",
        );
      }
      if (
        input.compareAtPriceInPaise !== null &&
        input.compareAtPriceInPaise <= input.priceInPaise
      ) {
        throw new CatalogueError(
          "The compare-at price must be higher than the price.",
          "COMPARE_AT",
        );
      }
      const clash = await tx.productVariant.findUnique({
        where: { sku: input.sku },
        select: { id: true },
      });
      if (clash)
        throw new CatalogueError(
          `SKU ${input.sku} is already in use.`,
          "SKU_TAKEN",
        );
      const values = await resolveOptionValues(
        tx,
        productId,
        input.optionValueIds,
      );
      const duplicate = await tx.productVariant.findFirst({
        where: {
          productId,
          AND: values.map((v) => ({
            optionValues: { some: { optionValueId: v.optionValueId } },
          })),
        },
        select: { id: true },
      });
      if (values.length > 0 && duplicate) {
        throw new CatalogueError(
          "A variant with that combination already exists.",
          "VARIANT_DUPLICATE",
        );
      }
      const created = await tx.productVariant.create({
        data: {
          productId,
          sku: input.sku,
          title: variantTitle(values),
          priceInPaise: input.priceInPaise,
          compareAtPriceInPaise: input.compareAtPriceInPaise,
          weightGrams: input.weightGrams,
          isActive: input.isActive,
          position: product._count.variants,
          inventory: {
            create: {
              stockOnHand: 0,
              lowStockThreshold: input.lowStockThreshold,
            },
          },
          optionValues: {
            create: values.map((v) => ({
              optionId: v.optionId,
              optionValueId: v.optionValueId,
            })),
          },
        },
        select: {
          id: true,
          sku: true,
          priceInPaise: true,
          compareAtPriceInPaise: true,
          isActive: true,
        },
      });
      if (input.initialStock > 0) {
        await applyAdjustment(tx, {
          variantId: created.id,
          kind: "RECEIVED",
          delta: input.initialStock,
          reason: `Initial stock for ${created.sku}`,
          actorId: ctx.user.id,
          auditId: audit.id,
        });
      }
      return {
        result: { id: created.id },
        targetId: created.id,
        after: variantSnapshot(created),
      };
    },
  );
}

export async function updateVariant(
  ctx: StaffContext,
  variantId: string,
  input: VariantInput,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "variant.update",
      targetType: "variant",
      targetId: variantId,
      capability: "catalogue.edit",
      now,
    },
    async (tx) => {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
        select: {
          id: true,
          productId: true,
          sku: true,
          priceInPaise: true,
          compareAtPriceInPaise: true,
          isActive: true,
          _count: { select: { orderItems: true } },
        },
      });
      if (!variant) throw new NotFoundError("Variant");
      if (variant.sku !== input.sku && variant._count.orderItems > 0) {
        throw new CatalogueError(
          "The SKU is fixed once an order references it.",
          "SKU_IMMUTABLE",
        );
      }
      if (
        input.compareAtPriceInPaise !== null &&
        input.compareAtPriceInPaise <= input.priceInPaise
      ) {
        throw new CatalogueError(
          "The compare-at price must be higher than the price.",
          "COMPARE_AT",
        );
      }
      if (variant.sku !== input.sku) {
        const clash = await tx.productVariant.findUnique({
          where: { sku: input.sku },
          select: { id: true },
        });
        if (clash)
          throw new CatalogueError(
            `SKU ${input.sku} is already in use.`,
            "SKU_TAKEN",
          );
      }
      const values = await resolveOptionValues(
        tx,
        variant.productId,
        input.optionValueIds,
      );
      await tx.productVariantValue.deleteMany({ where: { variantId } });
      const after = await tx.productVariant.update({
        where: { id: variantId },
        data: {
          sku: input.sku,
          title: variantTitle(values),
          priceInPaise: input.priceInPaise,
          compareAtPriceInPaise: input.compareAtPriceInPaise,
          weightGrams: input.weightGrams,
          isActive: input.isActive,
          optionValues: {
            create: values.map((v) => ({
              optionId: v.optionId,
              optionValueId: v.optionValueId,
            })),
          },
        },
        select: {
          id: true,
          sku: true,
          priceInPaise: true,
          compareAtPriceInPaise: true,
          isActive: true,
        },
      });
      return {
        result: undefined,
        before: variantSnapshot(variant),
        after: variantSnapshot(after),
      };
    },
  );
}

export async function deleteVariant(
  ctx: StaffContext,
  variantId: string,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "variant.delete",
      targetType: "variant",
      targetId: variantId,
      capability: "catalogue.delete",
      now,
    },
    async (tx) => {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
        select: {
          id: true,
          sku: true,
          priceInPaise: true,
          compareAtPriceInPaise: true,
          isActive: true,
          _count: {
            select: { orderItems: true, cartItems: true, adjustments: true },
          },
        },
      });
      if (!variant) throw new NotFoundError("Variant");
      if (
        variant._count.orderItems > 0 ||
        variant._count.cartItems > 0 ||
        variant._count.adjustments > 0
      ) {
        throw new CatalogueError(
          "Orders, carts or stock movements reference this variant: deactivate it instead.",
          "VARIANT_REFERENCED",
        );
      }
      await tx.productVariant.delete({ where: { id: variantId } });
      return { result: undefined, before: variantSnapshot(variant) };
    },
  );
}

// ---------------------------------------------------------------------------
// Images (A2a–A2c)
// ---------------------------------------------------------------------------

export interface UploadTicket {
  readonly cloudName: string;
  readonly apiKey: string;
  readonly uploadUrl: string;
  /** Exactly the signed fields, to be sent as-is with the file. */
  readonly fields: Readonly<Record<string, string>>;
  readonly signature: string;
  readonly timestamp: number;
  readonly publicId: string;
  readonly maxBytes: number;
  readonly formats: readonly string[];
}

/** A2a: record the intent, then sign exactly what the browser will send. */
export async function issueUploadTicket(
  ctx: StaffContext,
  productId: string,
  now = new Date(),
): Promise<UploadTicket> {
  const config = env.cloudinary;
  if (!config) {
    throw new CatalogueError(
      "Image uploads are not configured on this server; add an image by address instead.",
      "UPLOADS_NOT_CONFIGURED",
    );
  }
  const policy = getAdminPolicy().uploads;
  const folder = `${policy.folder}/${productId}`;
  const publicId = `${folder}/${randomBytes(9)
    .toString("base64url")
    .replace(/[^A-Za-z0-9_-]/g, "")}`;
  const ledger = await runAudited(
    {
      ctx,
      action: "image.upload.issue",
      targetType: "upload",
      capability: "catalogue.images",
      now,
    },
    async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      if (!product) throw new NotFoundError("Product");
      const row = await tx.productImageUpload.create({
        data: {
          productId,
          publicId,
          folder,
          issuedById: ctx.user.id,
          status: "ISSUED",
          issuedAt: now,
        },
        select: { id: true, publicId: true, status: true },
      });
      return { result: row, targetId: row.id, after: row };
    },
  );
  const timestamp = Math.floor(now.getTime() / 1000); // policy-literal-ok: ms → s
  const fields: Record<string, string> = {
    timestamp: String(timestamp),
    folder,
    public_id: ledger.publicId,
    allowed_formats: policy.formats.join(","),
    transformation: `c_limit,w_${policy.maxDimension},h_${policy.maxDimension}`,
  };
  if (config.uploadPreset) fields.upload_preset = config.uploadPreset;
  const signature = signParams(fields, config.apiSecret);
  return {
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`,
    fields,
    signature,
    timestamp,
    publicId: ledger.publicId,
    maxBytes: policy.maxBytes,
    formats: policy.formats,
  };
}

export interface UploadResponseFacts {
  readonly publicId: string;
  readonly version: string;
  readonly signature: string;
  readonly format: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly resourceType: string;
  readonly alt: string;
}

/** A2b: trust nothing from the browser except what the provider signed. */
export async function attachUploadedImage(
  ctx: StaffContext,
  productId: string,
  facts: UploadResponseFacts,
  now = new Date(),
): Promise<{ imageId: string }> {
  const config = env.cloudinary;
  if (!config)
    throw new CatalogueError(
      "Image uploads are not configured on this server.",
      "UPLOADS_NOT_CONFIGURED",
    );
  const policy = getAdminPolicy().uploads;
  return runAudited(
    {
      ctx,
      action: "image.attach",
      targetType: "image",
      targetId: null,
      capability: "catalogue.images",
      now,
    },
    async (tx) => {
      if (
        expectedResponseSignature(
          facts.publicId,
          facts.version,
          config.apiSecret,
        ) !== facts.signature
      ) {
        throw new CatalogueError(
          "The upload response signature is not valid.",
          "UPLOAD_SIGNATURE_INVALID",
        );
      }
      if (facts.resourceType !== "image")
        throw new CatalogueError(
          "Only images can be attached.",
          "UPLOAD_NOT_IMAGE",
        );
      if (!policy.formats.includes(facts.format)) {
        throw new CatalogueError(
          `Format ${facts.format} is not allowed.`,
          "UPLOAD_FORMAT",
        );
      }
      if (facts.bytes > policy.maxBytes)
        throw new CatalogueError(
          "The image is larger than allowed.",
          "UPLOAD_TOO_LARGE",
        );
      if (
        facts.width < policy.minDimension ||
        facts.height < policy.minDimension ||
        facts.width > policy.maxDimension ||
        facts.height > policy.maxDimension
      ) {
        throw new CatalogueError(
          `Images must be between ${policy.minDimension} and ${policy.maxDimension} pixels on each side.`,
          "UPLOAD_DIMENSIONS",
        );
      }
      if (
        !isWithinUploadFolder(facts.publicId, `${policy.folder}/${productId}`)
      ) {
        throw new CatalogueError(
          "That asset is not in this product's folder.",
          "UPLOAD_FOLDER",
        );
      }
      const claimed = await tx.productImageUpload.updateMany({
        where: { productId, publicId: facts.publicId, status: "ISSUED" },
        data: { status: "ATTACHED", resolvedAt: now },
      });
      if (claimed.count !== 1) {
        throw new CatalogueError(
          "No pending upload matches that asset.",
          "UPLOAD_NOT_ISSUED",
        );
      }
      const position = await tx.productImage.count({ where: { productId } });
      const url = `https://res.cloudinary.com/${encodeURIComponent(config.cloudName)}/image/upload/v${facts.version}/${facts.publicId}.${facts.format}`;
      const image = await tx.productImage.create({
        data: {
          productId,
          url,
          publicId: facts.publicId,
          alt: facts.alt,
          width: facts.width,
          height: facts.height,
          position,
        },
        select: {
          id: true,
          publicId: true,
          position: true,
          width: true,
          height: true,
        },
      });
      return {
        result: { imageId: image.id },
        targetId: image.id,
        after: image,
      };
    },
  );
}

/** Without Cloudinary (development), an image can be referenced by address. */
export async function addImageByUrl(
  ctx: StaffContext,
  productId: string,
  input: { url: string; alt: string; width: number; height: number },
  now = new Date(),
): Promise<{ imageId: string }> {
  return runAudited(
    {
      ctx,
      action: "image.add_url",
      targetType: "image",
      capability: "catalogue.images",
      now,
    },
    async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      if (!product) throw new NotFoundError("Product");
      const position = await tx.productImage.count({ where: { productId } });
      const image = await tx.productImage.create({
        data: {
          productId,
          url: input.url,
          publicId: null,
          alt: input.alt,
          width: input.width,
          height: input.height,
          position,
        },
        select: {
          id: true,
          publicId: true,
          position: true,
          width: true,
          height: true,
        },
      });
      return {
        result: { imageId: image.id },
        targetId: image.id,
        after: image,
      };
    },
  );
}

export async function updateImage(
  ctx: StaffContext,
  imageId: string,
  input: { alt: string; variantId: string | null },
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "image.update",
      targetType: "image",
      targetId: imageId,
      capability: "catalogue.images",
      now,
    },
    async (tx) => {
      const image = await tx.productImage.findUnique({
        where: { id: imageId },
        select: {
          id: true,
          productId: true,
          publicId: true,
          position: true,
          variantId: true,
          width: true,
          height: true,
        },
      });
      if (!image) throw new NotFoundError("Image");
      if (input.variantId) {
        const variant = await tx.productVariant.findFirst({
          where: { id: input.variantId, productId: image.productId },
          select: { id: true },
        });
        if (!variant)
          throw new CatalogueError(
            "That variant belongs to another product.",
            "VARIANT_MISMATCH",
          );
      }
      const after = await tx.productImage.update({
        where: { id: imageId },
        data: { alt: input.alt, variantId: input.variantId },
        select: {
          id: true,
          publicId: true,
          position: true,
          variantId: true,
          width: true,
          height: true,
        },
      });
      return { result: undefined, before: image, after };
    },
  );
}

export async function moveImage(
  ctx: StaffContext,
  imageId: string,
  direction: "up" | "down",
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "image.move",
      targetType: "image",
      targetId: imageId,
      capability: "catalogue.images",
      now,
    },
    async (tx) => {
      const image = await tx.productImage.findUnique({
        where: { id: imageId },
        select: { id: true, productId: true, position: true, publicId: true },
      });
      if (!image) throw new NotFoundError("Image");
      const siblings = await tx.productImage.findMany({
        where: { productId: image.productId },
        select: { id: true },
        orderBy: { position: "asc" },
      });
      const index = siblings.findIndex((s) => s.id === imageId);
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= siblings.length)
        return { result: undefined, before: image, after: image };
      const order = [...siblings];
      const current = order[index];
      const other = order[target];
      if (!current || !other)
        return { result: undefined, before: image, after: image };
      order[index] = other;
      order[target] = current;
      for (const [position, row] of order.entries()) {
        await tx.productImage.update({
          where: { id: row.id },
          data: { position },
        });
      }
      return {
        result: undefined,
        before: image,
        after: { ...image, position: target },
      };
    },
  );
}

/** A2c: delete the row, mark the ledger, then destroy the asset (best effort, retried by the sweep). */
export async function removeImage(
  ctx: StaffContext,
  imageId: string,
  now = new Date(),
): Promise<void> {
  const removed = await runAudited(
    {
      ctx,
      action: "image.remove",
      targetType: "image",
      targetId: imageId,
      capability: "catalogue.images",
      now,
    },
    async (tx) => {
      const image = await tx.productImage.findUnique({
        where: { id: imageId },
        select: {
          id: true,
          productId: true,
          publicId: true,
          position: true,
          width: true,
          height: true,
        },
      });
      if (!image) throw new NotFoundError("Image");
      await tx.productImage.delete({ where: { id: imageId } });
      if (image.publicId) {
        await tx.productImageUpload.updateMany({
          where: { publicId: image.publicId, status: "ATTACHED" },
          data: {
            status: "DISCARDED",
            resolvedAt: now,
            sweepError: "Pending delete at Cloudinary.",
          },
        });
      }
      const rest = await tx.productImage.findMany({
        where: { productId: image.productId },
        select: { id: true },
        orderBy: { position: "asc" },
      });
      for (const [position, row] of rest.entries()) {
        await tx.productImage.update({
          where: { id: row.id },
          data: { position },
        });
      }
      return { result: image, before: image };
    },
  );
  if (!removed.publicId || !env.cloudinary) return;
  try {
    await destroyCloudinaryImage(removed.publicId, { now });
    await db.productImageUpload.updateMany({
      where: { publicId: removed.publicId, status: "DISCARDED" },
      data: { status: "SWEPT", sweepError: null },
    });
  } catch {
    // The ledger row keeps its sweepError; the daily sweep retries the delete.
  }
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export interface CategoryInput {
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly parentId: string | null;
  readonly position: number;
  readonly isActive: boolean;
}

async function assertNoCycle(
  tx: Tx,
  categoryId: string,
  parentId: string | null,
): Promise<void> {
  let cursor = parentId;
  for (let depth = 0; cursor && depth < 50; depth += 1) {
    if (cursor === categoryId)
      throw new CatalogueError(
        "A category cannot sit under itself.",
        "CATEGORY_CYCLE",
      );
    const parent = await tx.category.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    if (!parent)
      throw new CatalogueError(
        "Choose an existing parent.",
        "CATEGORY_NOT_FOUND",
      );
    cursor = parent.parentId;
  }
}

const categorySnapshotSelect = {
  id: true,
  slug: true,
  name: true,
  parentId: true,
  isActive: true,
  position: true,
} satisfies Prisma.CategorySelect;

export async function createCategory(
  ctx: StaffContext,
  input: CategoryInput,
  now = new Date(),
): Promise<{ id: string }> {
  return runAudited(
    {
      ctx,
      action: "category.create",
      targetType: "category",
      capability: "catalogue.edit",
      now,
    },
    async (tx) => {
      if (input.parentId) {
        const parent = await tx.category.findUnique({
          where: { id: input.parentId },
          select: { id: true },
        });
        if (!parent)
          throw new CatalogueError(
            "Choose an existing parent.",
            "CATEGORY_NOT_FOUND",
          );
      }
      const slug = input.slug.trim().toLowerCase() || slugify(input.name);
      const clash = await tx.category.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (clash)
        throw new CatalogueError(
          `Slug ${slug} is already in use.`,
          "SLUG_TAKEN",
        );
      const created = await tx.category.create({
        data: {
          name: input.name,
          slug,
          description: input.description,
          parentId: input.parentId,
          position: input.position,
          isActive: input.isActive,
        },
        select: categorySnapshotSelect,
      });
      return {
        result: { id: created.id },
        targetId: created.id,
        after: created,
      };
    },
  );
}

export async function updateCategory(
  ctx: StaffContext,
  categoryId: string,
  input: CategoryInput,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "category.update",
      targetType: "category",
      targetId: categoryId,
      capability: "catalogue.edit",
      now,
    },
    async (tx) => {
      const before = await tx.category.findUnique({
        where: { id: categoryId },
        select: categorySnapshotSelect,
      });
      if (!before) throw new NotFoundError("Category");
      await assertNoCycle(tx, categoryId, input.parentId);
      const slug = input.slug.trim().toLowerCase() || slugify(input.name);
      const clash = await tx.category.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (clash && clash.id !== categoryId)
        throw new CatalogueError(
          `Slug ${slug} is already in use.`,
          "SLUG_TAKEN",
        );
      const after = await tx.category.update({
        where: { id: categoryId },
        data: {
          name: input.name,
          slug,
          description: input.description,
          parentId: input.parentId,
          position: input.position,
          isActive: input.isActive,
        },
        select: categorySnapshotSelect,
      });
      return { result: undefined, before, after };
    },
  );
}

export async function deleteCategory(
  ctx: StaffContext,
  categoryId: string,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "category.delete",
      targetType: "category",
      targetId: categoryId,
      capability: "catalogue.delete",
      now,
    },
    async (tx) => {
      const category = await tx.category.findUnique({
        where: { id: categoryId },
        select: {
          ...categorySnapshotSelect,
          _count: { select: { products: true, children: true } },
        },
      });
      if (!category) throw new NotFoundError("Category");
      if (category._count.products > 0 || category._count.children > 0) {
        throw new CatalogueError(
          "Move its products and sub-categories first.",
          "CATEGORY_IN_USE",
        );
      }
      await tx.category.delete({ where: { id: categoryId } });
      return { result: undefined, before: category };
    },
  );
}
