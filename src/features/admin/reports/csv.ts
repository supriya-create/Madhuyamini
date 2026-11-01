/** CSV rendering for exports (pure). Cells that spreadsheets would execute are neutralised. */

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  // A leading formula character would be executed by some spreadsheets.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(
  rows: ReadonlyArray<ReadonlyArray<string | number | null>>,
): string {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
