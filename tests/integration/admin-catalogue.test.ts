import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenCapabilityError } from "@/features/admin/authz";
import { parseOptionLines, slugify } from "@/features/admin/catalogue/schemas";
import {
  CatalogueError,
  addImageByUrl,
  archiveProduct,
  attachUploadedImage,
  createCategory,
  createProduct,
  createVariant,
  deleteCategory,
  deleteProduct,
  deleteVariant,
  getProductList,
  issueUploadTicket,
  moveImage,
  publishProduct,
  removeImage,
  saveOptions,
  updateCategory,
  updateProduct,
  updateVariant,
} from "@/features/admin/catalogue/service";
import type { ProductInput } from "@/features/admin/catalogue/schemas";
import { db } from "@/server/db";
import { env } from "@/server/env";
import {
  expectedResponseSignature,
  signParams,
} from "@/server/uploads/signature";

import { createCategory as seedCategory, resetDatabase, testDb } from "./db";
import { confirmedOnlineOrder, stockOf } from "./order-fixtures";
import { verifiedStaff } from "./staff";

/**
 * Catalogue operations (docs/admin.md §5.2, A1–A4): drafts, publish rules,
 * options and variants, signed uploads with a ledger, images and categories.
 */

beforeEach(resetDatabase);
afterAll(async () => {
  await testDb.$disconnect();
  await db.$disconnect();
});

function draftInput(
  categoryId: string,
  overrides: Partial<ProductInput> = {},
): ProductInput {
  return {
    title: "Peacock pallu dupatta",
    slug: "",
    subtitle: null,
    description:
      "A hand-painted peacock on handwoven cotton, development test data only.",
    techniques: ["HAND_PAINTED"],
    constructionMethods: ["HANDWOVEN"],
    material: "Cotton",
    careInstructions: null,
    categoryId,
    isFeatured: false,
    isOneOfAKind: false,
    metaTitle: null,
    metaDescription: null,
    hsnCode: null,
    taxRateBp: null,
    ...overrides,
  };
}

describe("products", () => {
  it("creates drafts with generated unique slugs, edits them and lists them", async () => {
    const staff = await verifiedStaff("STAFF");
    const category = await seedCategory("dupattas");
    const first = await createProduct(staff.ctx, draftInput(category.id));
    const second = await createProduct(staff.ctx, draftInput(category.id));
    const rows = await testDb.product.findMany({
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((r) => [r.slug, r.status])).toEqual([
      ["peacock-pallu-dupatta", "DRAFT"],
      ["peacock-pallu-dupatta-2", "DRAFT"],
    ]);

    await updateProduct(
      staff.ctx,
      first.id,
      draftInput(category.id, {
        title: "Peacock dupatta",
        slug: "PEACOCK-Dupatta",
        isFeatured: true,
      }),
    );
    const updated = await testDb.product.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(updated).toMatchObject({
      title: "Peacock dupatta",
      slug: "peacock-dupatta",
      isFeatured: true,
    });

    const list = await getProductList(staff.ctx, {
      status: "DRAFT",
      q: "peacock",
      page: 1,
    });
    expect(list.items.map((i) => i.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    const audit = await testDb.adminAuditLog.findMany({
      where: { targetType: "product" },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((a) => [a.action, a.outcome])).toEqual([
      ["product.create", "SUCCESS"],
      ["product.create", "SUCCESS"],
      ["product.update", "SUCCESS"],
    ]);
    expect(slugify("  Café   Crème & Co! ")).toBe("cafe-creme-co");
  });

  it("publishes only with a sellable variant and a described image, ADMIN only; archives and restores", async () => {
    const staff = await verifiedStaff("STAFF");
    const admin = await verifiedStaff("ADMIN");
    const category = await seedCategory("saris");
    const { id } = await createProduct(staff.ctx, draftInput(category.id));

    await expect(publishProduct(staff.ctx, id)).rejects.toBeInstanceOf(
      ForbiddenCapabilityError,
    );
    await expect(publishProduct(admin.ctx, id)).rejects.toMatchObject({
      code: "NO_SELLABLE_VARIANT",
    });

    const variant = await createVariant(staff.ctx, id, {
      sku: "DUP-PEACOCK-1",
      priceInPaise: 249_900,
      compareAtPriceInPaise: null,
      weightGrams: 300,
      isActive: true,
      optionValueIds: [],
      initialStock: 4,
      lowStockThreshold: 1,
    });
    expect(await stockOf(variant.id)).toEqual({ stockOnHand: 4, reserved: 0 });
    const adjustment = await testDb.inventoryAdjustment.findFirstOrThrow({
      where: { variantId: variant.id },
    });
    expect(adjustment).toMatchObject({
      kind: "RECEIVED",
      delta: 4,
      stockBefore: 0,
      stockAfter: 4,
      actorId: staff.user.id,
    });
    expect(adjustment.auditId).toBeTruthy();

    await expect(publishProduct(admin.ctx, id)).rejects.toMatchObject({
      code: "NO_IMAGE",
    });
    await addImageByUrl(staff.ctx, id, {
      url: "https://example.com/dupatta.jpg",
      alt: "Peacock dupatta on a loom",
      width: 1200,
      height: 1600,
    });
    await publishProduct(admin.ctx, id);
    let product = await testDb.product.findUniqueOrThrow({ where: { id } });
    expect(product.status).toBe("ACTIVE");
    expect(product.publishedAt).toBeInstanceOf(Date);

    await expect(
      deleteProduct(admin.ctx, id, product.slug),
    ).rejects.toMatchObject({ code: "PRODUCT_REFERENCED" });
    await archiveProduct(admin.ctx, id);
    product = await testDb.product.findUniqueOrThrow({ where: { id } });
    expect(product.status).toBe("ARCHIVED");
    await expect(
      deleteProduct(admin.ctx, id, "wrong-slug"),
    ).rejects.toMatchObject({ code: "CONFIRMATION_MISMATCH" });
    // The stock ledger is immutable, so a product whose variant has
    // movements can only ever be archived.
    await expect(
      deleteProduct(admin.ctx, id, product.slug),
    ).rejects.toMatchObject({ code: "PRODUCT_REFERENCED" });
    const empty = await createProduct(
      staff.ctx,
      draftInput(category.id, { title: "Never stocked" }),
    );
    await deleteProduct(admin.ctx, empty.id, "never-stocked");
    expect(await testDb.product.count()).toBe(1);
  });

  it("keeps a SKU fixed and a variant undeletable once an order references it", async () => {
    const staff = await verifiedStaff("STAFF");
    const admin = await verifiedStaff("ADMIN");
    const placed = await confirmedOnlineOrder({ sku: "CAT-REF" });
    const variant = await testDb.productVariant.findUniqueOrThrow({
      where: { id: placed.variantId },
    });
    const base = {
      priceInPaise: variant.priceInPaise,
      compareAtPriceInPaise: null,
      weightGrams: null,
      isActive: true,
      optionValueIds: [],
    };
    await expect(
      updateVariant(staff.ctx, variant.id, { ...base, sku: "CAT-NEW" }),
    ).rejects.toMatchObject({ code: "SKU_IMMUTABLE" });
    await updateVariant(staff.ctx, variant.id, {
      ...base,
      sku: variant.sku,
      priceInPaise: 99_900,
      isActive: false,
    });
    expect(
      await testDb.productVariant.findUniqueOrThrow({
        where: { id: variant.id },
      }),
    ).toMatchObject({ priceInPaise: 99_900, isActive: false });
    await expect(deleteVariant(admin.ctx, variant.id)).rejects.toMatchObject({
      code: "VARIANT_REFERENCED",
    });
    await expect(deleteVariant(staff.ctx, variant.id)).rejects.toBeInstanceOf(
      ForbiddenCapabilityError,
    );
  });
});

describe("options and variants", () => {
  it("parses option lines and refuses to drop values used by variants", async () => {
    expect(parseOptionLines("Size: XS, S, M\nColour: Indigo, Ochre")).toEqual([
      { name: "Size", values: ["XS", "S", "M"] },
      { name: "Colour", values: ["Indigo", "Ochre"] },
    ]);
    expect(() => parseOptionLines("Size XS S")).toThrow(/Name: value/);
    expect(() => parseOptionLines("Size: XS\nsize: S")).toThrow(/twice/);

    const staff = await verifiedStaff("STAFF");
    const category = await seedCategory("kurtas");
    const { id } = await createProduct(staff.ctx, draftInput(category.id));
    await saveOptions(staff.ctx, id, [{ name: "Size", values: ["S", "M"] }]);
    const sizes = await testDb.productOptionValue.findMany({
      orderBy: { position: "asc" },
    });
    expect(sizes.map((v) => v.value)).toEqual(["S", "M"]);
    const small = sizes[0];
    if (!small) throw new Error("no value");

    await expect(
      createVariant(staff.ctx, id, {
        sku: "KUR-1",
        priceInPaise: 1000,
        compareAtPriceInPaise: null,
        weightGrams: null,
        isActive: true,
        optionValueIds: [],
        initialStock: 0,
        lowStockThreshold: 2,
      }),
    ).rejects.toMatchObject({ code: "OPTION_VALUE_REQUIRED" });
    const variant = await createVariant(staff.ctx, id, {
      sku: "KUR-S",
      priceInPaise: 1000,
      compareAtPriceInPaise: 1500,
      weightGrams: null,
      isActive: true,
      optionValueIds: [small.id],
      initialStock: 0,
      lowStockThreshold: 2,
    });
    expect(
      (
        await testDb.productVariant.findUniqueOrThrow({
          where: { id: variant.id },
        })
      ).title,
    ).toBe("S");
    await expect(
      createVariant(staff.ctx, id, {
        sku: "KUR-S2",
        priceInPaise: 1000,
        compareAtPriceInPaise: null,
        weightGrams: null,
        isActive: true,
        optionValueIds: [small.id],
        initialStock: 0,
        lowStockThreshold: 2,
      }),
    ).rejects.toMatchObject({ code: "VARIANT_DUPLICATE" });
    await expect(
      saveOptions(staff.ctx, id, [{ name: "Size", values: ["M"] }]),
    ).rejects.toMatchObject({ code: "OPTION_VALUE_IN_USE" });
    await saveOptions(staff.ctx, id, [
      { name: "Size", values: ["S", "M", "L"] },
      { name: "Colour", values: ["Indigo"] },
    ]);
    expect(await testDb.productOption.count()).toBe(2);
    await expect(
      createVariant(staff.ctx, id, {
        sku: "KUR-X",
        priceInPaise: 1000,
        compareAtPriceInPaise: 900,
        weightGrams: null,
        isActive: true,
        optionValueIds: [small.id],
        initialStock: 0,
        lowStockThreshold: 2,
      }),
    ).rejects.toMatchObject({ code: "COMPARE_AT" });
  });
});

describe("images and signed uploads (A2, A4)", () => {
  it("issues a ledger-backed signature, verifies the provider's response and attaches; tampering is refused", async () => {
    const staff = await verifiedStaff("STAFF");
    const category = await seedCategory("art");
    const { id } = await createProduct(staff.ctx, draftInput(category.id));
    const secret = env.cloudinary?.apiSecret;
    if (!secret) throw new Error("test env must configure Cloudinary values");

    const ticket = await issueUploadTicket(staff.ctx, id);
    expect(ticket.publicId.startsWith(`madhuyamini/products/${id}/`)).toBe(
      true,
    );
    expect(ticket.fields.folder).toBe(`madhuyamini/products/${id}`);
    expect(ticket.fields.allowed_formats).toBe("jpg,png,webp,avif");
    expect(ticket.fields.transformation).toBe("c_limit,w_6000,h_6000");
    expect(ticket.signature).toBe(signParams(ticket.fields, secret));
    const ledger = await testDb.productImageUpload.findUniqueOrThrow({
      where: { publicId: ticket.publicId },
    });
    expect(ledger).toMatchObject({
      status: "ISSUED",
      issuedById: staff.user.id,
      productId: id,
    });

    const good = {
      publicId: ticket.publicId,
      version: "1700000000",
      signature: expectedResponseSignature(
        ticket.publicId,
        "1700000000",
        secret,
      ),
      format: "jpg",
      bytes: 512_000,
      width: 1600,
      height: 2000,
      resourceType: "image",
      alt: "Painted fish on handmade paper",
    };
    await expect(
      attachUploadedImage(staff.ctx, id, {
        ...good,
        signature: "0".repeat(40),
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_SIGNATURE_INVALID" });
    await expect(
      attachUploadedImage(staff.ctx, id, { ...good, width: 400 }),
    ).rejects.toMatchObject({ code: "UPLOAD_DIMENSIONS" });
    await expect(
      attachUploadedImage(staff.ctx, id, { ...good, format: "gif" }),
    ).rejects.toMatchObject({ code: "UPLOAD_FORMAT" });
    await expect(
      attachUploadedImage(staff.ctx, id, { ...good, bytes: 9_000_000 }),
    ).rejects.toMatchObject({ code: "UPLOAD_TOO_LARGE" });
    const foreign = `madhuyamini/products/${id}-other/x`;
    await expect(
      attachUploadedImage(staff.ctx, id, {
        ...good,
        publicId: foreign,
        signature: expectedResponseSignature(foreign, good.version, secret),
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_FOLDER" });
    expect(
      (
        await testDb.productImageUpload.findUniqueOrThrow({
          where: { publicId: ticket.publicId },
        })
      ).status,
    ).toBe("ISSUED");
    expect(await testDb.productImage.count()).toBe(0);

    const { imageId } = await attachUploadedImage(staff.ctx, id, good);
    const image = await testDb.productImage.findUniqueOrThrow({
      where: { id: imageId },
    });
    expect(image).toMatchObject({
      publicId: ticket.publicId,
      width: 1600,
      height: 2000,
      position: 0,
    });
    expect(image.url).toBe(
      `https://res.cloudinary.com/${env.cloudinary?.cloudName}/image/upload/v1700000000/${ticket.publicId}.jpg`,
    );
    expect(
      (
        await testDb.productImageUpload.findUniqueOrThrow({
          where: { publicId: ticket.publicId },
        })
      ).status,
    ).toBe("ATTACHED");
    // A second attach of the same asset finds no pending ticket.
    await expect(
      attachUploadedImage(staff.ctx, id, good),
    ).rejects.toMatchObject({ code: "UPLOAD_NOT_ISSUED" });

    const second = await addImageByUrl(staff.ctx, id, {
      url: "https://example.com/b.jpg",
      alt: "Detail",
      width: 900,
      height: 900,
    });
    await moveImage(staff.ctx, second.imageId, "up");
    const ordered = await testDb.productImage.findMany({
      where: { productId: id },
      orderBy: { position: "asc" },
    });
    expect(ordered.map((i) => i.id)).toEqual([second.imageId, imageId]);

    await removeImage(staff.ctx, imageId);
    expect(await testDb.productImage.count({ where: { productId: id } })).toBe(
      1,
    );
    // No real Cloudinary here: the ledger keeps the delete pending for the sweep.
    const discarded = await testDb.productImageUpload.findUniqueOrThrow({
      where: { publicId: ticket.publicId },
    });
    expect(discarded.status).toBe("DISCARDED");
    expect(discarded.sweepError).toBeTruthy();
    const audits = await testDb.adminAuditLog.findMany({
      where: {
        action: { in: ["image.upload.issue", "image.attach", "image.remove"] },
      },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((a) => [a.action, a.outcome])).toEqual([
      ["image.upload.issue", "SUCCESS"],
      ["image.attach", "FAILED"],
      ["image.attach", "FAILED"],
      ["image.attach", "FAILED"],
      ["image.attach", "FAILED"],
      ["image.attach", "FAILED"],
      ["image.attach", "SUCCESS"],
      ["image.attach", "FAILED"],
      ["image.remove", "SUCCESS"],
    ]);
  });
});

describe("categories", () => {
  it("creates, nests with a cycle check, and deletes only empty categories (ADMIN)", async () => {
    const staff = await verifiedStaff("STAFF");
    const admin = await verifiedStaff("ADMIN");
    const base = { description: null, position: 0, isActive: true };
    const parent = await createCategory(staff.ctx, {
      ...base,
      name: "Clothing",
      slug: "",
      parentId: null,
    });
    const child = await createCategory(staff.ctx, {
      ...base,
      name: "Saris",
      slug: "saris",
      parentId: parent.id,
    });
    await expect(
      createCategory(staff.ctx, {
        ...base,
        name: "Saris again",
        slug: "saris",
        parentId: null,
      }),
    ).rejects.toMatchObject({ code: "SLUG_TAKEN" });
    await expect(
      updateCategory(staff.ctx, parent.id, {
        ...base,
        name: "Clothing",
        slug: "clothing",
        parentId: child.id,
      }),
    ).rejects.toMatchObject({ code: "CATEGORY_CYCLE" });
    await expect(deleteCategory(admin.ctx, parent.id)).rejects.toMatchObject({
      code: "CATEGORY_IN_USE",
    });
    await expect(deleteCategory(staff.ctx, child.id)).rejects.toBeInstanceOf(
      ForbiddenCapabilityError,
    );
    await deleteCategory(admin.ctx, child.id);
    await deleteCategory(admin.ctx, parent.id);
    expect(await testDb.category.count()).toBe(0);
    expect(new CatalogueError("x").code).toBe("CATALOGUE_NOT_ALLOWED");
  });
});
