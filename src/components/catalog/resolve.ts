import { notFound, redirect } from "next/navigation";

import { NotFoundError, ValidationError } from "@/server/errors";

/**
 * Maps catalog service errors to page outcomes: unknown slugs become a 404,
 * malformed query strings redirect to the clean URL instead of erroring.
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
    throw error;
  }
  return result;
}
