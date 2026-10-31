import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getCategoryBySlug,
  getCategoryTree,
  getFeaturedProducts,
  getProductBySlug,
  listProducts,
} from "@/features/catalog/service";
import { db } from "@/server/db";
import { NotFoundError, ValidationError } from "@/server/errors";

import { seedCatalog } from "../../prisma/seed/catalog";
import { resetDatabase, testDb } from "./db";

/**
 * Service behaviour on top of the seeded development catalog. The seed runs
 * once; these tests only read.
 */

beforeAll(async () => {
  await resetDatabase();
  await seedCatalog(testDb);
});

afterAll(async () => {
  await testDb.$disconnect();
  await db.$disconnect();
});

describe("seedCatalog", () => {
  it("is idempotent: a second run changes nothing", async () => {
    const before = await counts();
    const summary = await seedCatalog(testDb);
    expect(summary).toEqual({ categories: 27, products: 9, variants: 17 });
    expect(await counts()).toEqual(before);
  });

  async function counts() {
    return {
      categories: await testDb.category.count(),
      products: await testDb.product.count(),
      variants: await testDb.productVariant.count(),
      values: await testDb.productVariantValue.count(),
      inventory: await testDb.inventory.count(),
    };
  }
});

describe("categories", () => {
  it("returns the two-level tree in display order", async () => {
    const tree = await getCategoryTree();
    expect(tree.map((node) => node.slug)).toEqual([
      "clothing",
      "wall-art",
      "home-decor",
      "accessories",
    ]);
    expect(tree[0]?.children.map((child) => child.slug)).toEqual([
      "sarees",
      "kurta-sets",
      "salwar-suits",
      "kurtis",
      "dupattas",
      "dress-materials",
      "stoles",
    ]);
  });

  it("resolves a child category with its parent", async () => {
    const sarees = await getCategoryBySlug("sarees");
    expect(sarees.parent?.slug).toBe("clothing");
    expect(sarees.children).toEqual([]);
  });

  it("hides inactive categories", async () => {
    await testDb.category.update({
      where: { slug: "stoles" },
      data: { isActive: false },
    });
    try {
      await expect(getCategoryBySlug("stoles")).rejects.toBeInstanceOf(
        NotFoundError,
      );
      const clothing = await getCategoryBySlug("clothing");
      expect(clothing.children.map((child) => child.slug)).not.toContain(
        "stoles",
      );
    } finally {
      await testDb.category.update({
        where: { slug: "stoles" },
        data: { isActive: true },
      });
    }
  });

  it("rejects malformed slugs before touching the database", async () => {
    await expect(getCategoryBySlug("Not A Slug")).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(getCategoryBySlug(42)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("listProducts", () => {
  it("returns only active products", async () => {
    const page = await listProducts({});
    expect(page.total).toBe(7);
    expect(page.items.map((item) => item.slug)).not.toContain(
      "sample-draft-wall-hanging",
    );
    expect(page.items.map((item) => item.slug)).not.toContain(
      "sample-archived-notebook",
    );
  });

  it("includes a parent category's children", async () => {
    const clothing = await listProducts({ category: "clothing" });
    expect(clothing.items.map((item) => item.slug).sort()).toEqual([
      "sample-fish-motif-tussar-saree",
      "sample-lotus-dupatta",
      "sample-peacock-kurta-set",
    ]);
    expect(clothing.category?.slug).toBe("clothing");

    const sarees = await listProducts({ category: "sarees" });
    expect(sarees.total).toBe(1);
  });

  it("paginates with stable ordering", async () => {
    const first = await listProducts({ sort: "title", pageSize: 3, page: 1 });
    const second = await listProducts({ sort: "title", pageSize: 3, page: 2 });
    const third = await listProducts({ sort: "title", pageSize: 3, page: 3 });

    expect(first.totalPages).toBe(3);
    expect([...first.items, ...second.items, ...third.items]).toHaveLength(7);
    const titles = [...first.items, ...second.items, ...third.items].map(
      (item) => item.title,
    );
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
  });

  it("summarises price range, stock and the primary image", async () => {
    const page = await listProducts({ category: "canvas-prints" });
    const canvas = page.items[0];
    expect(canvas?.price).toEqual({ fromInPaise: 249_900, toInPaise: 549_900 });
    expect(canvas?.inStock).toBe(true);
    expect(canvas?.image).toBeNull();
    expect(canvas?.technique).toBe("DIGITAL_PRINT");
  });

  it("rejects unknown categories and invalid queries", async () => {
    await expect(
      listProducts({ category: "no-such-category" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(listProducts({ page: 0 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(listProducts({ sort: "cheapest" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("getProductBySlug", () => {
  it("returns options, variants and per-variant availability", async () => {
    const kurta = await getProductBySlug("sample-peacock-kurta-set");

    expect(kurta.options).toHaveLength(1);
    expect(kurta.options[0]?.values.map((value) => value.value)).toEqual([
      "XS",
      "S",
      "M",
      "L",
      "XL",
    ]);
    expect(kurta.variants).toHaveLength(5);

    const bySize = new Map(
      kurta.variants.map((variant) => [variant.title, variant]),
    );
    expect(bySize.get("XS")).toMatchObject({
      available: 0,
      stockStatus: "out_of_stock",
      isPurchasable: false,
    });
    expect(bySize.get("XL")).toMatchObject({
      available: 1,
      stockStatus: "low_stock",
    });
    expect(bySize.get("M")).toMatchObject({
      available: 8,
      stockStatus: "in_stock",
    });

    const sizeOption = kurta.options[0];
    for (const variant of kurta.variants) {
      expect(variant.optionValueIds).toHaveLength(1);
      expect(sizeOption?.values.map((value) => value.id)).toContain(
        variant.optionValueIds[0],
      );
    }
    expect(kurta.seo).toEqual({
      title: "Peacock kurta set",
      description: "Development sample",
    });
  });

  it("marks a one-of-a-kind original and reflects reservations", async () => {
    const original = await getProductBySlug("sample-kohbar-original");
    expect(original.isOneOfAKind).toBe(true);
    expect(original.variants[0]).toMatchObject({
      available: 1,
      isPurchasable: true,
    });

    const variantId = original.variants[0]?.id;
    if (!variantId) throw new Error("expected a variant");
    await testDb.inventory.update({
      where: { variantId },
      data: { reserved: 1 },
    });
    try {
      const reserved = await getProductBySlug("sample-kohbar-original");
      expect(reserved.variants[0]).toMatchObject({
        available: 0,
        isPurchasable: false,
      });
      expect(reserved.inStock).toBe(false);
    } finally {
      await testDb.inventory.update({
        where: { variantId },
        data: { reserved: 0 },
      });
    }
  });

  it("never exposes draft or archived products", async () => {
    await expect(
      getProductBySlug("sample-draft-wall-hanging"),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getProductBySlug("sample-archived-notebook"),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getProductBySlug("DROP TABLE products"),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("getFeaturedProducts", () => {
  it("returns only active featured products within the limit", async () => {
    const featured = await getFeaturedProducts();
    expect(featured.map((item) => item.slug).sort()).toEqual([
      "sample-fish-motif-tussar-saree",
      "sample-fish-tote-bag",
      "sample-kohbar-original",
      "sample-tree-of-life-canvas-print",
    ]);
    expect(await getFeaturedProducts(2)).toHaveLength(2);
    await expect(getFeaturedProducts(0)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
