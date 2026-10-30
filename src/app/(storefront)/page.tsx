import { Craftsmanship } from "@/components/home/Craftsmanship";
import { Heritage } from "@/components/home/Heritage";
import { Hero } from "@/components/home/Hero";
import { Introduction } from "@/components/home/Introduction";

/**
 * Homepage. Sections that depend on catalog data (category collections,
 * featured and best-selling products, reviews, newsletter) are added in
 * Phases 2–3 once real data exists — see docs/roadmap.md.
 */
export default function HomePage() {
  return (
    <>
      <Hero />
      <Introduction />
      <Heritage />
      <Craftsmanship />
    </>
  );
}
