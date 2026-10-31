import { Heart } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { toggleWishlistAction } from "@/features/wishlist/actions";

import styles from "./WishlistToggle.module.css";

type WishlistToggleProps = {
  productId: string;
  productTitle: string;
  saved: boolean;
  returnTo: string;
  variant?: "icon" | "button";
};

/** Server-rendered toggle; guests are sent to sign in and brought back. */
export function WishlistToggle({
  productId,
  productTitle,
  saved,
  returnTo,
  variant = "icon",
}: WishlistToggleProps) {
  return (
    <form
      action={toggleWishlistAction}
      className={styles.form}
      data-variant={variant}
    >
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button
        type="submit"
        className={styles.button}
        aria-pressed={saved}
        data-saved={saved}
      >
        <Icon icon={Heart} size={20} className={styles.icon} />
        {variant === "button" ? (
          <span>{saved ? "Saved to wishlist" : "Save to wishlist"}</span>
        ) : (
          <span className="visually-hidden">
            {saved
              ? `Remove ${productTitle} from your wishlist`
              : `Save ${productTitle} to your wishlist`}
          </span>
        )}
      </button>
    </form>
  );
}
