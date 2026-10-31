import { CategoryCollections } from "@/components/home/CategoryCollections";
import { Craftsmanship } from "@/components/home/Craftsmanship";
import { FeaturedProducts } from "@/components/home/FeaturedProducts";
import { Heritage } from "@/components/home/Heritage";
import { Hero } from "@/components/home/Hero";
import { Introduction } from "@/components/home/Introduction";

/**
 * Homepage. Category and featured sections read the catalog and hide
 * themselves when there is nothing to show. Reviews and the newsletter wait
 * for Phases 8 and 2.5 respectively (docs/roadmap.md).
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <CategoryCollections />
      <Introduction />
      <FeaturedProducts />
      <Heritage />
      <Craftsmanship />
    </>
  );
}
