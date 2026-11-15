import { notFound, redirect } from "next/navigation";

import { PageOutOfRangeError } from "@/features/catalog/errors";
import { listingHref } from "@/features/catalog/urls";
import { NotFoundError, ValidationError } from "@/server/errors";

/**
 * Maps catalog service errors to page outcomes: unknown slugs become a 404,
 * malformed query strings redirect to the clean URL instead of erroring, and
 * a page past the end redirects to the last page with the same filters,
 * sort and search term (an empty result never redirects, so no loop).
 */
export async function resolveCatalog<T>(
  load: () => Promise<T>,
  cleanHref: string,
): Promise<T> {
  let result: T;
  try {
    result = await load();
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ValidationError) redirect(cleanHref);
    if (error instanceof PageOutOfRangeError) {
      redirect(
        listingHref(cleanHref, error.filters, error.lastPage, error.pageSize),
      );
    }
    throw error;
  }
  return result;
}
