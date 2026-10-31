import { navCategories } from "../../src/content/navigation";
import type { AppPrismaClient } from "../../src/server/prisma-client";

import { productFixtures } from "./fixtures";
import type { ProductFixture } from "./fixtures";

export interface SeedSummary {
  readonly categories: number;
  readonly products: number;
  readonly variants: number;
}

/**
 * Idempotent: every record is upserted by its natural key (slug, SKU,
 * product + option name, option + value), so re-running converges on the
 * same state instead of duplicating rows.
 */
export async function seedCatalog(
  prisma: AppPrismaClient,
): Promise<SeedSummary> {
  const categories = await seedCategories(prisma);

  let variants = 0;
  for (const fixture of productFixtures) {
    variants += await seedProduct(prisma, fixture);
  }

  return { categories, products: productFixtures.length, variants };
}

/** The agreed two-level taxonomy, taken from the navigation content so the two never drift. */
async function seedCategories(prisma: AppPrismaClient): Promise<number> {
  let count = 0;

  for (const [parentPosition, parent] of navCategories.entries()) {
    const parentRow = await prisma.category.upsert({
      where: { slug: parent.id },
      create: { slug: parent.id, name: parent.label, position: parentPosition },
      update: { name: parent.label, position: parentPosition },
      select: { id: true },
    });
    count += 1;

    for (const [position, child] of parent.children.entries()) {
      if (!child.slug) continue;
      await prisma.category.upsert({
        where: { slug: child.slug },
        create: {
          slug: child.slug,
          name: child.label,
          position,
          parentId: parentRow.id,
        },
        update: { name: child.label, position, parentId: parentRow.id },
        select: { id: true },
      });
      count += 1;
    }
  }

  return count;
}

async function seedProduct(
  prisma: AppPrismaClient,
  fixture: ProductFixture,
): Promise<number> {
  const category = await prisma.category.findUniqueOrThrow({
    where: { slug: fixture.categorySlug },
    select: { id: true },
  });

  return prisma.$transaction(async (tx) => {
    const productData = {
      title: fixture.title,
      subtitle: fixture.subtitle,
      description: fixture.description,
      techniques: [...fixture.techniques],
      constructionMethods: [...(fixture.constructionMethods ?? [])],
      material: fixture.material ?? null,
      careInstructions: fixture.careInstructions ?? null,
      categoryId: category.id,
      status: fixture.status,
      isFeatured: fixture.isFeatured ?? false,
      isOneOfAKind: fixture.isOneOfAKind ?? false,
    };

    const product = await tx.product.upsert({
      where: { slug: fixture.slug },
      create: {
        slug: fixture.slug,
        ...productData,
        publishedAt: fixture.status === "ACTIVE" ? new Date() : null,
      },
      update: productData,
      select: { id: true },
    });

    // Options and their values, keyed by name so variants can reference them.
    const optionIdByName = new Map<string, string>();
    const valueIdByOptionAndValue = new Map<string, string>();

    for (const [position, option] of (fixture.options ?? []).entries()) {
      const optionRow = await tx.productOption.upsert({
        where: { productId_name: { productId: product.id, name: option.name } },
        create: { productId: product.id, name: option.name, position },
        update: { position },
        select: { id: true },
      });
      optionIdByName.set(option.name, optionRow.id);

      for (const [valuePosition, value] of option.values.entries()) {
        const valueRow = await tx.productOptionValue.upsert({
          where: { optionId_value: { optionId: optionRow.id, value } },
          create: { optionId: optionRow.id, value, position: valuePosition },
          update: { position: valuePosition },
          select: { id: true },
        });
        valueIdByOptionAndValue.set(
          `${option.name}\u0000${value}`,
          valueRow.id,
        );
      }
    }

    for (const [position, variant] of fixture.variants.entries()) {
      const optionNames = (fixture.options ?? []).map((option) => option.name);
      const selectedValues = variant.optionValues ?? [];
      if (selectedValues.length !== optionNames.length) {
        throw new Error(
          `Fixture ${fixture.slug} variant ${variant.sku} must select one value per option`,
        );
      }

      const variantData = {
        title: selectedValues.length > 0 ? selectedValues.join(" / ") : null,
        priceInPaise: variant.priceInPaise,
        compareAtPriceInPaise: variant.compareAtPriceInPaise ?? null,
        weightGrams: variant.weightGrams ?? null,
        position,
        isActive: variant.isActive ?? true,
      };

      const variantRow = await tx.productVariant.upsert({
        where: { sku: variant.sku },
        create: { sku: variant.sku, productId: product.id, ...variantData },
        update: variantData,
        select: { id: true },
      });

      await tx.inventory.upsert({
        where: { variantId: variantRow.id },
        create: {
          variantId: variantRow.id,
          stockOnHand: variant.stockOnHand,
          lowStockThreshold: variant.lowStockThreshold ?? 2,
        },
        update: {
          stockOnHand: variant.stockOnHand,
          lowStockThreshold: variant.lowStockThreshold ?? 2,
        },
      });

      // Replace the variant's option selections wholesale so fixture edits converge.
      await tx.productVariantValue.deleteMany({
        where: { variantId: variantRow.id },
      });
      await tx.productVariantValue.createMany({
        data: optionNames.map((optionName, index) => {
          const value = selectedValues[index];
          const optionId = optionIdByName.get(optionName);
          const optionValueId =
            value === undefined
              ? undefined
              : valueIdByOptionAndValue.get(`${optionName}\u0000${value}`);
          if (!optionId || !optionValueId) {
            throw new Error(
              `Fixture ${fixture.slug}: unknown option value for ${variant.sku}`,
            );
          }
          return { variantId: variantRow.id, optionId, optionValueId };
        }),
      });
    }

    return fixture.variants.length;
  });
}
