import { z } from "zod";

export const REPORTS = [
  "sales",
  "products",
  "inventory",
  "operations",
] as const;
export type ReportName = (typeof REPORTS)[number];

export const GRANULARITIES = ["day", "week", "month"] as const;
export type Granularity = (typeof GRANULARITIES)[number];

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((value) => new Date(`${value}T00:00:00+05:30`))
  .refine((value) => !Number.isNaN(value.getTime()), "Invalid date");

export const reportQuerySchema = z.object({
  report: z.enum(REPORTS).optional().catch(undefined),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  granularity: z.enum(GRANULARITIES).optional().catch(undefined),
});

export interface ReportWindow {
  readonly from: Date;
  /** Exclusive. */
  readonly to: Date;
  readonly granularity: Granularity;
}

const DAY_MS = 24 * 60 * 60 * 1000; // policy-literal-ok: time unit

/** Defaults to the last 30 days, ending tomorrow (exclusive), in IST. */
export function resolveWindow(
  query: z.output<typeof reportQuerySchema>,
  now = new Date(),
): ReportWindow {
  const to = query.to
    ? new Date(query.to.getTime() + DAY_MS)
    : new Date(now.getTime() + DAY_MS);
  const from = query.from ?? new Date(to.getTime() - 30 * DAY_MS); // policy-literal-ok: default window
  return {
    from,
    to: to > from ? to : new Date(from.getTime() + DAY_MS),
    granularity: query.granularity ?? "day",
  };
}

export function toIsoDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}
