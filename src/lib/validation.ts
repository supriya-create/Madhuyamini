import type { z } from "zod";

import { ValidationError } from "@/server/errors";

/** Parses with a Zod schema and converts failures into a safe `ValidationError`. */
export function parseOrThrow<T extends z.ZodType>(
  schema: T,
  input: unknown,
): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  throw new ValidationError(
    result.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  );
}
