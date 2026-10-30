/** Joins class names, skipping falsy values. */
export function cx(
  ...classNames: ReadonlyArray<string | false | null | undefined>
): string {
  return classNames.filter(Boolean).join(" ");
}
