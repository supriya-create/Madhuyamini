import type { z } from "zod";

import type { FieldErrors, FormState } from "./schemas";
import { fieldErrorsFrom } from "./schemas";

/**
 * Picks only the named fields from a submitted form. Next.js adds `$ACTION_*`
 * entries for progressive enhancement, and strict schemas must not see them.
 */
export function pickFormValues<const K extends readonly string[]>(
  formData: FormData,
  keys: K,
): Record<K[number], string> {
  const values = {} as Record<K[number], string>;
  for (const key of keys) {
    const value = formData.get(key);
    values[key as K[number]] = typeof value === "string" ? value : "";
  }
  return values;
}

export function parseForm<T extends z.ZodType>(
  schema: T,
  values: unknown,
): { ok: true; data: z.output<T> } | { ok: false; state: FormState } {
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };
  const fieldErrors: FieldErrors = fieldErrorsFrom(result.error);
  return {
    ok: false,
    state: {
      status: "error",
      message: "Please check the highlighted fields.",
      fieldErrors,
    },
  };
}
