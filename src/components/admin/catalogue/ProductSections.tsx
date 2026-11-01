import Link from "next/link";

import styles from "@/components/admin/Admin.module.css";
import { AdminActionForm } from "@/components/admin/AdminActionForm";
import { Badge } from "@/components/admin/orders/StatusBadge";
import { Field } from "@/components/forms/Field";
import fieldStyles from "@/components/forms/Field.module.css";
import { SelectField } from "@/components/forms/SelectField";
import { TextareaField } from "@/components/forms/TextareaField";
import {
  addImageByUrlAction,
  archiveProductAction,
  createVariantAction,
  deleteProductAction,
  deleteVariantAction,
  moveImageAction,
  publishProductAction,
  removeImageAction,
  restoreProductAction,
  saveOptionsAction,
  updateImageAction,
  updateVariantAction,
} from "@/features/admin/catalogue/actions";
import type { ProductEditRow } from "@/features/admin/catalogue/data";
import { formatINR } from "@/lib/money";
import { routes } from "@/lib/routes";

import { ImageUploader } from "./ImageUploader";

/** The status, option, variant and image sections of the product page. */

export function StatusSection({
  product,
  isAdmin,
}: {
  product: ProductEditRow;
  isAdmin: boolean;
}) {
  const hidden = { productId: product.id };
  return (
    <section className={styles.panel} aria-labelledby="product-status">
      <h2 id="product-status" className={styles.panelTitle}>
        Status
      </h2>
      <p>
        <Badge
          tone={
            product.status === "ACTIVE"
              ? "good"
              : product.status === "ARCHIVED"
                ? "bad"
                : "warn"
          }
        >
          {product.status}
        </Badge>{" "}
        {product.status === "ACTIVE" ? (
          <Link href={routes.product(product.slug)}>
            View in the storefront
          </Link>
        ) : null}
      </p>
      {!isAdmin ? (
        <p className={styles.muted}>
          Publishing and archiving are admin actions.
        </p>
      ) : null}
      {isAdmin && product.status !== "ACTIVE" ? (
        <AdminActionForm
          action={publishProductAction}
          hidden={hidden}
          submitLabel="Publish"
        >
          <p className={styles.muted}>
            Needs at least one active variant with a price and one described
            image.
          </p>
        </AdminActionForm>
      ) : null}
      {isAdmin && product.status === "ACTIVE" ? (
        <AdminActionForm
          action={archiveProductAction}
          hidden={hidden}
          submitLabel="Archive"
          variant="secondary"
        >
          <p className={styles.muted}>
            Hides it from the storefront; carts flag the lines. Nothing is
            deleted.
          </p>
        </AdminActionForm>
      ) : null}
      {isAdmin && product.status === "ARCHIVED" ? (
        <AdminActionForm
          action={restoreProductAction}
          hidden={hidden}
          submitLabel="Back to draft"
          variant="secondary"
        />
      ) : null}
      {isAdmin && product.status !== "ACTIVE" ? (
        <details className={styles.details} data-danger="true">
          <summary>Delete permanently</summary>
          <div>
            <AdminActionForm
              action={deleteProductAction}
              hidden={hidden}
              submitLabel="Delete this product"
              variant="secondary"
            >
              <Field
                id="delete-slug"
                name="confirmSlug"
                label={`Type ${product.slug} to confirm`}
                autoComplete="off"
                required
              />
              <p className={styles.muted}>
                Only possible while nothing references it. Admin only, with a
                fresh second factor.
              </p>
            </AdminActionForm>
          </div>
        </details>
      ) : null}
    </section>
  );
}

export function OptionsSection({ product }: { product: ProductEditRow }) {
  const text = product.options
    .map((o) => `${o.name}: ${o.values.map((v) => v.value).join(", ")}`)
    .join("\n");
  return (
    <section className={styles.panel} aria-labelledby="product-options">
      <h2 id="product-options" className={styles.panelTitle}>
        Options
      </h2>
      <AdminActionForm
        action={saveOptionsAction}
        hidden={{ productId: product.id }}
        submitLabel="Save options"
        variant="secondary"
        wide
      >
        <TextareaField
          id="options-text"
          name="options"
          label="One option per line, as Name: value, value"
          hint="For example “Size: XS, S, M, L”. Values used by existing variants cannot be removed."
          rows={4}
          defaultValue={text}
          maxLength={2000}
        />
      </AdminActionForm>
    </section>
  );
}

function OptionValuePickers({
  product,
  prefix,
  selected,
}: {
  product: ProductEditRow;
  prefix: string;
  selected?: ReadonlySet<string>;
}) {
  if (product.options.length === 0) return null;
  return (
    <>
      {product.options.map((option) => (
        <SelectField
          key={option.id}
          id={`${prefix}-opt-${option.id}`}
          name="optionValueIds"
          label={option.name}
          placeholder={`Choose ${option.name.toLowerCase()}`}
          defaultValue={
            option.values.find((v) => selected?.has(v.id))?.id ?? ""
          }
          options={option.values.map((v) => ({ value: v.id, label: v.value }))}
          required
        />
      ))}
    </>
  );
}

export function VariantsSection({ product }: { product: ProductEditRow }) {
  return (
    <section className={styles.panel} aria-labelledby="product-variants">
      <h2 id="product-variants" className={styles.panelTitle}>
        Variants
      </h2>
      {product.variants.length === 0 ? (
        <p className={styles.muted}>
          No variants yet. Nothing can be sold until one exists.
        </p>
      ) : null}
      {product.variants.map((variant) => {
        const chosen = new Set(
          variant.optionValues.map((v) => v.optionValueId),
        );
        const referenced =
          variant._count.orderItems > 0 || variant._count.cartItems > 0;
        return (
          <details key={variant.id} className={styles.details}>
            <summary>
              {variant.sku}
              {variant.title ? ` · ${variant.title}` : ""} ·{" "}
              {formatINR(variant.priceInPaise)} ·{" "}
              {variant.inventory
                ? `${variant.inventory.stockOnHand - variant.inventory.reserved} available`
                : "no stock row"}
              {variant.isActive ? "" : " · inactive"}
            </summary>
            <div className={styles.actions}>
              <p className={styles.muted}>
                <Link href={routes.adminInventoryVariant(variant.id)}>
                  Stock movements and adjustments
                </Link>
                {variant._count.orderItems > 0
                  ? ` · ${variant._count.orderItems} order line(s); the SKU is fixed.`
                  : ""}
              </p>
              <AdminActionForm
                action={updateVariantAction}
                hidden={{ productId: product.id, variantId: variant.id }}
                submitLabel="Save variant"
                variant="secondary"
              >
                <Field
                  id={`v-${variant.id}-sku`}
                  name="sku"
                  label="SKU"
                  defaultValue={variant.sku}
                  readOnly={variant._count.orderItems > 0}
                  required
                />
                <Field
                  id={`v-${variant.id}-price`}
                  name="price"
                  label="Price (₹)"
                  defaultValue={(variant.priceInPaise / 100).toFixed(2)}
                  inputMode="decimal"
                  required
                />
                <Field
                  id={`v-${variant.id}-compare`}
                  name="compareAt"
                  label="Compare-at price (₹, optional)"
                  defaultValue={
                    variant.compareAtPriceInPaise
                      ? (variant.compareAtPriceInPaise / 100).toFixed(2)
                      : ""
                  }
                  inputMode="decimal"
                />
                <Field
                  id={`v-${variant.id}-weight`}
                  name="weightGrams"
                  label="Weight in grams (optional)"
                  defaultValue={variant.weightGrams ?? ""}
                  inputMode="numeric"
                />
                <OptionValuePickers
                  product={product}
                  prefix={`v-${variant.id}`}
                  selected={chosen}
                />
                <div className={styles.inline}>
                  <input
                    type="checkbox"
                    id={`v-${variant.id}-active`}
                    name="isActive"
                    value="on"
                    defaultChecked={variant.isActive}
                  />
                  <label htmlFor={`v-${variant.id}-active`}>
                    Active (purchasable)
                  </label>
                </div>
              </AdminActionForm>
              {!referenced ? (
                <AdminActionForm
                  action={deleteVariantAction}
                  hidden={{ productId: product.id, variantId: variant.id }}
                  submitLabel="Delete variant"
                  variant="quiet"
                />
              ) : (
                <p className={styles.muted}>
                  Referenced by orders or carts: deactivate instead of deleting.
                </p>
              )}
            </div>
          </details>
        );
      })}
      <details className={styles.details}>
        <summary>Add a variant</summary>
        <div>
          <AdminActionForm
            action={createVariantAction}
            hidden={{ productId: product.id }}
            submitLabel="Add variant"
          >
            <Field
              id="nv-sku"
              name="sku"
              label="SKU"
              hint="Letters, digits and hyphens; unique across the shop."
              required
            />
            <Field
              id="nv-price"
              name="price"
              label="Price (₹)"
              inputMode="decimal"
              required
            />
            <Field
              id="nv-compare"
              name="compareAt"
              label="Compare-at price (₹, optional)"
              inputMode="decimal"
            />
            <Field
              id="nv-weight"
              name="weightGrams"
              label="Weight in grams (optional)"
              inputMode="numeric"
            />
            <OptionValuePickers product={product} prefix="nv" />
            <Field
              id="nv-stock"
              name="initialStock"
              label="Units in stock now"
              hint="Recorded as a received-stock adjustment."
              type="number"
              inputMode="numeric"
              min={0}
              defaultValue={0}
              required
            />
            <Field
              id="nv-threshold"
              name="lowStockThreshold"
              label="Low-stock threshold"
              type="number"
              inputMode="numeric"
              min={0}
              defaultValue={2}
              required
            />
            <div className={styles.inline}>
              <input
                type="checkbox"
                id="nv-active"
                name="isActive"
                value="on"
                defaultChecked
              />
              <label htmlFor="nv-active">Active (purchasable)</label>
            </div>
          </AdminActionForm>
        </div>
      </details>
    </section>
  );
}

export function ImagesSection({
  product,
  uploadsConfigured,
}: {
  product: ProductEditRow;
  uploadsConfigured: boolean;
}) {
  return (
    <section className={styles.panel} aria-labelledby="product-images">
      <h2 id="product-images" className={styles.panelTitle}>
        Images
      </h2>
      {product.images.length === 0 ? (
        <p className={styles.muted}>
          No images yet; one with a description is needed to publish.
        </p>
      ) : null}
      <ul className={styles.timeline}>
        {product.images.map((image, index) => (
          <li key={image.id} className={styles.timelineItem}>
            <div className={styles.inline}>
              {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail of an arbitrary https source */}
              <img
                src={image.url}
                alt={image.alt}
                width={96}
                height={Math.round((96 * image.height) / image.width) || 96}
              />
              <div>
                <div>{image.alt}</div>
                <div className={styles.muted}>
                  {image.width} × {image.height}
                  {image.publicId ? ` · ${image.publicId}` : " · by address"}
                </div>
              </div>
            </div>
            <div className={styles.inline}>
              {index > 0 ? (
                <AdminActionForm
                  action={moveImageAction}
                  hidden={{
                    productId: product.id,
                    imageId: image.id,
                    direction: "up",
                  }}
                  submitLabel="Move up"
                  variant="quiet"
                />
              ) : null}
              {index < product.images.length - 1 ? (
                <AdminActionForm
                  action={moveImageAction}
                  hidden={{
                    productId: product.id,
                    imageId: image.id,
                    direction: "down",
                  }}
                  submitLabel="Move down"
                  variant="quiet"
                />
              ) : null}
              <AdminActionForm
                action={removeImageAction}
                hidden={{ productId: product.id, imageId: image.id }}
                submitLabel="Remove"
                variant="quiet"
              />
            </div>
            <details className={styles.details}>
              <summary>Edit description and variant</summary>
              <div>
                <AdminActionForm
                  action={updateImageAction}
                  hidden={{ productId: product.id, imageId: image.id }}
                  submitLabel="Save image"
                  variant="secondary"
                >
                  <Field
                    id={`img-${image.id}-alt`}
                    name="alt"
                    label="Description"
                    defaultValue={image.alt}
                    required
                    maxLength={300}
                  />
                  <SelectField
                    id={`img-${image.id}-variant`}
                    name="variantId"
                    label="Shows a specific variant (optional)"
                    placeholder="Whole product"
                    defaultValue={image.variantId ?? ""}
                    options={product.variants.map((v) => ({
                      value: v.id,
                      label: v.title ? `${v.sku} · ${v.title}` : v.sku,
                    }))}
                  />
                </AdminActionForm>
              </div>
            </details>
          </li>
        ))}
      </ul>
      {uploadsConfigured ? (
        <details className={styles.details} open={product.images.length === 0}>
          <summary>Upload an image</summary>
          <div>
            <ImageUploader productId={product.id} />
          </div>
        </details>
      ) : (
        <p className={fieldStyles.hint}>
          Cloudinary is not configured on this server, so files cannot be
          uploaded here.
        </p>
      )}
      <details className={styles.details}>
        <summary>Add an image by address</summary>
        <div>
          <AdminActionForm
            action={addImageByUrlAction}
            hidden={{ productId: product.id }}
            submitLabel="Add image"
            variant="secondary"
          >
            <Field
              id="url-image"
              name="url"
              label="Image address (https)"
              type="url"
              inputMode="url"
              required
              maxLength={1000}
            />
            <Field
              id="url-alt"
              name="alt"
              label="Description for people who cannot see it"
              required
              maxLength={300}
            />
            <Field
              id="url-width"
              name="width"
              label="Width in pixels"
              type="number"
              inputMode="numeric"
              min={1}
              required
            />
            <Field
              id="url-height"
              name="height"
              label="Height in pixels"
              type="number"
              inputMode="numeric"
              min={1}
              required
            />
          </AdminActionForm>
        </div>
      </details>
    </section>
  );
}
