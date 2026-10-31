import type { Metadata } from "next";

import { AccountShell } from "@/components/account/AccountShell";
import { EmptyState } from "@/components/catalog/EmptyState";
import { ProductGrid } from "@/components/catalog/ProductGrid";
import { WishlistToggle } from "@/components/cart/WishlistToggle";
import { listWishlist } from "@/features/wishlist/service";
import { requireUser } from "@/server/auth/current-user";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Wishlist",
  robots: { index: false, follow: false },
};

export default async function WishlistPage() {
  const user = await requireUser();
  const products = await listWishlist(user);
  return (
    <AccountShell user={user} title="Wishlist">
      {products.length === 0 ? (
        <EmptyState
          heading="Nothing saved yet"
          action={{ label: "Browse the collections", href: routes.collections }}
        >
          <p>Use the heart on any piece to keep it here.</p>
        </EmptyState>
      ) : (
        <ProductGrid
          products={products}
          columns={3}
          actions={(product) => (
            <WishlistToggle
              productId={product.id}
              productTitle={product.title}
              saved
              returnTo={routes.accountWishlist}
              variant="button"
            />
          )}
        />
      )}
    </AccountShell>
  );
}
