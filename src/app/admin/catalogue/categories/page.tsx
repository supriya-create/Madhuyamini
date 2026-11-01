import type { Metadata } from "next";

import styles from "@/components/admin/Admin.module.css";
import { AdminActionForm } from "@/components/admin/AdminActionForm";
import { AdminPageHeader } from "@/components/admin/AdminShell";
import { Field } from "@/components/forms/Field";
import { SelectField } from "@/components/forms/SelectField";
import { TextareaField } from "@/components/forms/TextareaField";
import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
} from "@/features/admin/catalogue/actions";
import type { CategoryAdminRow } from "@/features/admin/catalogue/data";
import { getCategories } from "@/features/admin/catalogue/service";
import { requireStaffSession } from "@/server/auth/staff";

export const metadata: Metadata = { title: "Categories" };

const NOTICES: Record<string, string> = {
  created: "Category created.",
  saved: "Category saved.",
  deleted: "Category deleted.",
};

function CategoryFields({
  category,
  all,
  prefix,
}: {
  category: CategoryAdminRow | null;
  all: ReadonlyArray<CategoryAdminRow>;
  prefix: string;
}) {
  const parents = all.filter(
    (c) => c.id !== category?.id && c.parentId === null,
  );
  return (
    <>
      <Field
        id={`${prefix}-name`}
        name="name"
        label="Name"
        defaultValue={category?.name ?? ""}
        required
        maxLength={80}
      />
      <Field
        id={`${prefix}-slug`}
        name="slug"
        label="Slug"
        hint="Leave empty to generate it from the name."
        defaultValue={category?.slug ?? ""}
        maxLength={80}
      />
      <TextareaField
        id={`${prefix}-description`}
        name="description"
        label="Description (optional)"
        defaultValue={category?.description ?? ""}
        maxLength={500}
      />
      <SelectField
        id={`${prefix}-parent`}
        name="parentId"
        label="Parent"
        placeholder="Top level"
        defaultValue={category?.parentId ?? ""}
        options={parents.map((p) => ({ value: p.id, label: p.name }))}
      />
      <Field
        id={`${prefix}-position`}
        name="position"
        label="Position"
        type="number"
        inputMode="numeric"
        min={0}
        defaultValue={category?.position ?? 0}
        required
      />
      <div className={styles.inline}>
        <input
          type="checkbox"
          id={`${prefix}-active`}
          name="isActive"
          value="on"
          defaultChecked={category?.isActive ?? true}
        />
        <label htmlFor={`${prefix}-active`}>Active (shown in navigation)</label>
      </div>
    </>
  );
}

export default async function CategoriesPage({
  searchParams,
}: PageProps<"/admin/catalogue/categories">) {
  const ctx = await requireStaffSession();
  const [categories, query] = await Promise.all([
    getCategories(ctx),
    searchParams,
  ]);
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const byParent = new Map<string | null, CategoryAdminRow[]>();
  for (const category of categories) {
    const list = byParent.get(category.parentId) ?? [];
    list.push(category);
    byParent.set(category.parentId, list);
  }
  const roots = byParent.get(null) ?? [];

  const renderCategory = (category: CategoryAdminRow, depth: number) => (
    <li
      key={category.id}
      className={styles.timelineItem}
      style={{ marginInlineStart: `${depth * 1.5}rem` }}
    >
      <details className={styles.details}>
        <summary>
          {category.name} <span className={styles.muted}>/{category.slug}</span>
          {category.isActive ? "" : " · inactive"} · {category._count.products}{" "}
          product(s)
          {category._count.children > 0
            ? ` · ${category._count.children} sub-categor${category._count.children === 1 ? "y" : "ies"}`
            : ""}
        </summary>
        <div className={styles.actions}>
          <AdminActionForm
            action={updateCategoryAction}
            hidden={{ categoryId: category.id }}
            submitLabel="Save category"
            variant="secondary"
          >
            <CategoryFields
              category={category}
              all={categories}
              prefix={`c-${category.id}`}
            />
          </AdminActionForm>
          {category._count.products === 0 && category._count.children === 0 ? (
            <AdminActionForm
              action={deleteCategoryAction}
              hidden={{ categoryId: category.id }}
              submitLabel="Delete category"
              variant="quiet"
            >
              <p className={styles.muted}>
                Admin only, with a fresh second factor.
              </p>
            </AdminActionForm>
          ) : null}
        </div>
      </details>
      {(byParent.get(category.id) ?? []).length > 0 ? (
        <ul className={styles.timeline}>
          {(byParent.get(category.id) ?? []).map((child) =>
            renderCategory(child, depth + 1),
          )}
        </ul>
      ) : null}
    </li>
  );

  return (
    <div>
      <AdminPageHeader
        title="Categories"
        lede="Two levels: a parent and its sub-categories. Deleting is possible only when a category has no products and no children."
      />
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}
      <div className={styles.grid}>
        <section className={styles.panel} aria-labelledby="category-tree">
          <h2 id="category-tree" className={styles.panelTitle}>
            Tree
          </h2>
          <ul className={styles.timeline}>
            {roots.map((root) => renderCategory(root, 0))}
          </ul>
        </section>
        <section className={styles.panel} aria-labelledby="category-new">
          <h2 id="category-new" className={styles.panelTitle}>
            New category
          </h2>
          <AdminActionForm
            action={createCategoryAction}
            hidden={{}}
            submitLabel="Create category"
          >
            <CategoryFields category={null} all={categories} prefix="new" />
          </AdminActionForm>
        </section>
      </div>
    </div>
  );
}
