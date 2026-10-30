import { z } from "zod";

/**
 * Environment schema, kept free of `server-only` so it can be unit-tested.
 * Application code must import `env` from `@/server/env` instead.
 */

const siteEnvSchema = z.enum(["development", "preview", "production"]);

export type SiteEnv = z.infer<typeof siteEnvSchema>;

export interface ServerEnv {
  /** Deployment stage. Controls indexing, development-only pages and placeholders. */
  readonly siteEnv: SiteEnv;
  /** Canonical origin used for metadata and absolute URLs. */
  readonly siteUrl: URL;
}

const DEFAULT_SITE_URL = "http://localhost:3000";

/** Treat empty strings as unset, which is how most hosts represent a cleared variable. */
const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().optional(),
);

const rawEnvSchema = z
  .object({
    SITE_ENV: z.preprocess(
      (value) => (value === "" ? undefined : value),
      siteEnvSchema.default("development"),
    ),
    SITE_URL: optionalString.pipe(z.url({ protocol: /^https?$/ }).optional()),
  })
  .superRefine((value, ctx) => {
    if (value.SITE_ENV !== "production") return;

    if (value.SITE_URL === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["SITE_URL"],
        message: "SITE_URL is required when SITE_ENV is production",
      });
    } else if (!value.SITE_URL.startsWith("https://")) {
      ctx.addIssue({
        code: "custom",
        path: ["SITE_URL"],
        message: "SITE_URL must use https in production",
      });
    }
  });

type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Validates the process environment and returns typed configuration.
 * Throws with a readable summary on failure. Values are never echoed back,
 * so secrets cannot leak into build or server logs.
 */
export function parseEnv(source: EnvSource): ServerEnv {
  const result = rawEnvSchema.safeParse({
    // Vercel sets VERCEL_ENV (production | preview | development) on every deployment.
    SITE_ENV: source.SITE_ENV ?? source.VERCEL_ENV,
    SITE_URL: source.SITE_URL,
  });

  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${z.prettifyError(result.error)}`,
    );
  }

  return {
    siteEnv: result.data.SITE_ENV,
    siteUrl: new URL(result.data.SITE_URL ?? DEFAULT_SITE_URL),
  };
}
