import Image from "next/image";
import Link from "next/link";

import { ProductImageFallback } from "@/components/catalog/ProductImageFallback";
import { Button } from "@/components/ui/Button";
import {
  acknowledgePriceAction,
  removeLineAction,
  updateLineAction,
} from "@/features/cart/actions";
import type { CartLineView } from "@/features/cart/types";
import { formatINR } from "@/lib/money";
import { routes } from "@/lib/routes";

import styles from "./CartLine.module.css";
import { QuantitySelect } from "./QuantitySelect";

const availabilityText: Record<CartLineView["availability"], string | null> = {
  ok: null,
  unavailable: "No longer available. Remove it to continue to checkout.",
  sold_out: "Sold out. Remove it to continue to checkout.",
  limited:
    "Fewer are available than you have chosen. Reduce the quantity to continue.",
};

export function CartLine({ line }: { line: CartLineView }) {
  const problem = availabilityText[line.availability];
  const optionsLabel = line.variant.title;

  return (
    <li className={styles.line} data-availability={line.availability}>
      <div className={styles.media}>
        {line.product.image ? (
          <Image
            src={line.product.image.url}
            alt={line.product.image.alt}
            width={line.product.image.width}
            height={line.product.image.height}
            sizes="(min-width: 48em) 10rem, 30vw"
            className={styles.image}
          />
        ) : (
          <ProductImageFallback title={line.product.title} aspect="square" />
        )}
      </div>

      <div className={styles.details}>
        <h3 className={styles.title}>
          <Link href={routes.product(line.product.slug)}>
            {line.product.title}
          </Link>
        </h3>
        {optionsLabel ? <p className={styles.meta}>{optionsLabel}</p> : null}
        <p className={styles.meta}>SKU {line.variant.sku}</p>

        {problem ? (
          <p className={styles.problem} role="status">
            {problem}
          </p>
        ) : null}

        {line.priceChanged ? (
          <form action={acknowledgePriceAction} className={styles.priceNotice}>
            <input type="hidden" name="lineId" value={line.id} />
            <p role="status">
              The price changed from {formatINR(line.priceSeenInPaise)} to{" "}
              <strong>{formatINR(line.unitPriceInPaise)}</strong> since you
              added this.
            </p>
            <Button type="submit" variant="quiet" className={styles.linkButton}>
              Got it
            </Button>
          </form>
        ) : null}
      </div>

      <div className={styles.controls}>
        <p className={styles.unit}>
          {formatINR(line.unitPriceInPaise)}
          {line.quantity > 1 ? (
            <span className={styles.each}> each</span>
          ) : null}
        </p>
        {line.availability === "unavailable" ||
        line.availability === "sold_out" ? null : (
          <form action={updateLineAction} className={styles.quantityForm}>
            <input type="hidden" name="lineId" value={line.id} />
            <QuantitySelect
              name="quantity"
              value={line.quantity}
              max={Math.max(line.maxQuantity, line.quantity)}
              available={line.available}
              label={`Quantity for ${line.product.title}`}
            />
            <noscript>
              <Button type="submit" variant="secondary">
                Update
              </Button>
            </noscript>
          </form>
        )}
        <form action={removeLineAction}>
          <input type="hidden" name="lineId" value={line.id} />
          <Button type="submit" variant="quiet" className={styles.linkButton}>
            Remove<span className="visually-hidden"> {line.product.title}</span>
          </Button>
        </form>
        <p className={styles.total}>
          {line.availability === "ok" ? (
            formatINR(line.lineTotalInPaise)
          ) : (
            <span className={styles.excluded}>Not included</span>
          )}
        </p>
      </div>
    </li>
  );
}
