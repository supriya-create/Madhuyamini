import type { Metadata } from "next";
import { notFound } from "next/navigation";

import styles from "@/components/admin/Admin.module.css";
import { AdminPageHeader } from "@/components/admin/AdminShell";
import { ProductForm } from "@/components/admin/catalogue/ProductForm";
import {
  ImagesSection,
  OptionsSection,
  StatusSection,
  VariantsSection,
} from "@/components/admin/catalogue/ProductSections";
import { updateProductAction } from "@/features/admin/catalogue/actions";
import { idSchema } from "@/features/admin/catalogue/schemas";
import {
  getCategories,
  getProductForEdit,
} from "@/features/admin/catalogue/service";
import { requireStaffSession } from "@/server/auth/staff";
import { cloudinaryConfigured } from "@/server/uploads/cloudinary";

export const metadata: Metadata = { title: "Product" };

const NOTICES: Record<string, string> = {
  created: "Draft created. Add variants and images below.",
  saved: "Product saved.",
  published: "Published; it is live in the storefront.",
  archived: "Archived; it is hidden from the storefront.",
  restored: "Back to draft.",
  options: "Options saved.",
  variant_created: "Variant added.",
  variant_saved: "Variant saved.",
  variant_deleted: "Variant deleted.",
  image_added: "Image attached.",
  image_saved: "Image saved.",
  image_removed: "Image removed.",
};

export default async function ProductPage({
  params,
  searchParams,
}: PageProps<"/admin/catalogue/products/[id]">) {
  const ctx = await requireStaffSession();
  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) notFound();
  const [product, categories, query] = await Promise.all([
    getProductForEdit(ctx, parsed.data),
    getCategories(ctx),
    searchParams,
  ]);
  if (!product) notFound();
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  return (
    <div>
      <AdminPageHeader
        title={product.title}
        lede={`${product.slug} · ${product.category.name}`}
      />
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}
      <div className={styles.grid}>
        <div className={styles.actions}>
          <section className={styles.panel} aria-labelledby="product-details">
            <h2 id="product-details" className={styles.panelTitle}>
              Details
            </h2>
            <ProductForm
              action={updateProductAction}
              product={product}
              categories={categories}
              submitLabel="Save product"
            />
          </section>
          <OptionsSection product={product} />
          <VariantsSection product={product} />
        </div>
        <div className={styles.actions}>
          <StatusSection product={product} isAdmin={ctx.role === "ADMIN"} />
          <ImagesSection
            product={product}
            uploadsConfigured={cloudinaryConfigured()}
          />
        </div>
      </div>
    </div>
  );
}
