import type { Metadata } from "next";

import { AdminPageHeader } from "@/components/admin/AdminShell";
import { ProductForm } from "@/components/admin/catalogue/ProductForm";
import { createProductAction } from "@/features/admin/catalogue/actions";
import { getCategories } from "@/features/admin/catalogue/service";
import { requireStaffSession } from "@/server/auth/staff";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const ctx = await requireStaffSession();
  const categories = await getCategories(ctx);
  return (
    <div>
      <AdminPageHeader
        title="New product"
        lede="Saved as a draft. Add variants and images, then an admin publishes it."
      />
      <ProductForm
        action={createProductAction}
        product={null}
        categories={categories}
        submitLabel="Create draft"
      />
    </div>
  );
}
