import styles from "@/components/admin/Admin.module.css";
import { AdminActionForm } from "@/components/admin/AdminActionForm";
import { Field } from "@/components/forms/Field";
import fieldStyles from "@/components/forms/Field.module.css";
import { SelectField } from "@/components/forms/SelectField";
import { TextareaField } from "@/components/forms/TextareaField";
import type {
  CategoryAdminRow,
  ProductEditRow,
} from "@/features/admin/catalogue/data";
import {
  constructionMethodLabels,
  techniqueLabels,
} from "@/features/catalog/labels";
import type { FormState } from "@/features/auth/schemas";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

function CheckboxGroup({
  name,
  legend,
  options,
  checked,
}: {
  name: string;
  legend: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  checked: ReadonlySet<string>;
}) {
  return (
    <fieldset className={styles.actionGroup}>
      <legend className={fieldStyles.label}>{legend}</legend>
      {options.map((option) => (
        <div key={option.value} className={styles.inline}>
          <input
            type="checkbox"
            id={`${name}-${option.value}`}
            name={name}
            value={option.value}
            defaultChecked={checked.has(option.value)}
          />
          <label htmlFor={`${name}-${option.value}`}>{option.label}</label>
        </div>
      ))}
    </fieldset>
  );
}

/** Create or edit a product's own fields (docs/admin.md §5.2). */
export function ProductForm({
  action,
  product,
  categories,
  submitLabel,
}: {
  action: Action;
  product: ProductEditRow | null;
  categories: ReadonlyArray<CategoryAdminRow>;
  submitLabel: string;
}) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const label = (c: CategoryAdminRow) =>
    c.parentId ? `${byId.get(c.parentId)?.name ?? "…"} › ${c.name}` : c.name;
  return (
    <AdminActionForm
      action={action}
      hidden={product ? { productId: product.id } : {}}
      submitLabel={submitLabel}
      pendingLabel="Saving…"
      wide
    >
      <Field
        id="p-title"
        name="title"
        label="Title"
        defaultValue={product?.title ?? ""}
        required
        maxLength={160}
      />
      <Field
        id="p-slug"
        name="slug"
        label="Slug"
        hint="Leave empty to generate it from the title. Lower-case letters, digits and hyphens."
        defaultValue={product?.slug ?? ""}
        maxLength={80}
      />
      <Field
        id="p-subtitle"
        name="subtitle"
        label="Subtitle (optional)"
        defaultValue={product?.subtitle ?? ""}
        maxLength={200}
      />
      <TextareaField
        id="p-description"
        name="description"
        label="Description"
        rows={6}
        defaultValue={product?.description ?? ""}
        required
        maxLength={5000}
      />
      <CheckboxGroup
        name="techniques"
        legend="Techniques (at least one; the first checked is the headline)"
        options={Object.entries(techniqueLabels).map(([value, text]) => ({
          value,
          label: text,
        }))}
        checked={new Set(product?.techniques ?? [])}
      />
      <CheckboxGroup
        name="constructionMethods"
        legend="Construction"
        options={Object.entries(constructionMethodLabels).map(
          ([value, text]) => ({ value, label: text }),
        )}
        checked={new Set(product?.constructionMethods ?? [])}
      />
      <Field
        id="p-material"
        name="material"
        label="Material (optional)"
        defaultValue={product?.material ?? ""}
        maxLength={200}
      />
      <TextareaField
        id="p-care"
        name="careInstructions"
        label="Care instructions (optional)"
        defaultValue={product?.careInstructions ?? ""}
        maxLength={1000}
      />
      <SelectField
        id="p-category"
        name="categoryId"
        label="Category"
        placeholder="Choose a category"
        defaultValue={product?.categoryId ?? ""}
        options={categories.map((c) => ({ value: c.id, label: label(c) }))}
        required
      />
      <div className={styles.inline}>
        <input
          type="checkbox"
          id="p-featured"
          name="isFeatured"
          value="on"
          defaultChecked={product?.isFeatured ?? false}
        />
        <label htmlFor="p-featured">Featured on the home page</label>
      </div>
      <div className={styles.inline}>
        <input
          type="checkbox"
          id="p-ooak"
          name="isOneOfAKind"
          value="on"
          defaultChecked={product?.isOneOfAKind ?? false}
        />
        <label htmlFor="p-ooak">
          One of a kind (a single original; one variant, stock 1)
        </label>
      </div>
      <Field
        id="p-meta-title"
        name="metaTitle"
        label="SEO title (optional)"
        defaultValue={product?.metaTitle ?? ""}
        maxLength={160}
      />
      <TextareaField
        id="p-meta-description"
        name="metaDescription"
        label="SEO description (optional)"
        defaultValue={product?.metaDescription ?? ""}
        maxLength={320}
      />
      <Field
        id="p-hsn"
        name="hsnCode"
        label="HSN code (optional)"
        defaultValue={product?.hsnCode ?? ""}
        maxLength={16}
      />
      <Field
        id="p-tax"
        name="taxRateBp"
        label="GST rate in basis points (optional)"
        hint="Leave empty while the shop is not GST-registered (D7c)."
        inputMode="numeric"
        defaultValue={product?.taxRateBp ?? ""}
      />
    </AdminActionForm>
  );
}
