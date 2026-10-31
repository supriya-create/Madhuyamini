import { z } from "zod";

/**
 * Environment schema, kept free of `server-only` so it can be unit-tested.
 * Application code must import `env` from `@/server/env` instead.
 */

const siteEnvSchema = z.enum(["development", "preview", "production"]);

export type SiteEnv = z.infer<typeof siteEnvSchema>;

export type EmailTransport = "file" | "log" | "resend";

export interface ServerEnv {
  /** Deployment stage. Controls indexing, development-only pages and placeholders. */
  readonly siteEnv: SiteEnv;
  /** Canonical origin used for metadata and absolute URLs. */
  readonly siteUrl: URL;
  /** PostgreSQL connection string. Never log or expose it. */
  readonly databaseUrl: string;
  /** Better Auth signing secret (≥ 32 characters). Never log or expose it. */
  readonly betterAuthSecret: string;
  readonly email: {
    readonly transport: EmailTransport;
    readonly from: string;
    /** Present only when the transport is Resend and a key was supplied. */
    readonly resendApiKey: string | null;
    /** Directory for the file transport. */
    readonly outboxDir: string;
  };
  /** Whether registration and password changes consult Have I Been Pwned. */
  readonly passwordBreachCheck: "hibp" | "off";
}

const DEFAULT_SITE_URL = "http://localhost:3000";

const POSTGRES_PROTOCOLS = new Set(["postgresql:", "postgres:"]);

function isPostgresUrl(value: string): boolean {
  try {
    return POSTGRES_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

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
    DATABASE_URL: z
      .string({ error: "DATABASE_URL is required" })
      .trim()
      .min(1, "DATABASE_URL is required")
      .refine(
        isPostgresUrl,
        "DATABASE_URL must be a postgresql:// connection string",
      ),
    BETTER_AUTH_SECRET: z
      .string({ error: "BETTER_AUTH_SECRET is required" })
      .trim()
      .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    EMAIL_TRANSPORT: optionalString.pipe(
      z.enum(["file", "log", "resend"]).optional(),
    ),
    EMAIL_FROM: optionalString,
    RESEND_API_KEY: optionalString,
    EMAIL_OUTBOX_DIR: optionalString,
    PASSWORD_BREACH_CHECK: optionalString.pipe(
      z.enum(["hibp", "off"]).optional(),
    ),
  })
  .superRefine((value, ctx) => {
    if (value.SITE_ENV !== "production") return;

    // Production must use a real email service. The API key itself is checked
    // when the transport is first used, not here, so a build or preview
    // without credentials still succeeds (owner requirement 6).
    if (
      value.EMAIL_TRANSPORT !== undefined &&
      value.EMAIL_TRANSPORT !== "resend"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_TRANSPORT"],
        message: "EMAIL_TRANSPORT must be resend in production",
      });
    }

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
    DATABASE_URL: source.DATABASE_URL,
    BETTER_AUTH_SECRET: source.BETTER_AUTH_SECRET,
    EMAIL_TRANSPORT: source.EMAIL_TRANSPORT,
    EMAIL_FROM: source.EMAIL_FROM,
    RESEND_API_KEY: source.RESEND_API_KEY,
    EMAIL_OUTBOX_DIR: source.EMAIL_OUTBOX_DIR,
    PASSWORD_BREACH_CHECK: source.PASSWORD_BREACH_CHECK,
  });

  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${z.prettifyError(result.error)}`,
    );
  }

  const production = result.data.SITE_ENV === "production";
  const transport =
    result.data.EMAIL_TRANSPORT ?? (production ? "resend" : "file");

  return {
    siteEnv: result.data.SITE_ENV,
    siteUrl: new URL(result.data.SITE_URL ?? DEFAULT_SITE_URL),
    databaseUrl: result.data.DATABASE_URL,
    betterAuthSecret: result.data.BETTER_AUTH_SECRET,
    email: {
      transport,
      from: result.data.EMAIL_FROM ?? "Madhuyamini <no-reply@localhost>",
      resendApiKey:
        transport === "resend" ? (result.data.RESEND_API_KEY ?? null) : null,
      outboxDir: result.data.EMAIL_OUTBOX_DIR ?? ".mail",
    },
    passwordBreachCheck:
      result.data.PASSWORD_BREACH_CHECK ?? (production ? "hibp" : "off"),
  };
}
