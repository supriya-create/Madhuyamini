import { z } from "zod";

/**
 * Environment schema, kept free of `server-only` so it can be unit-tested.
 * Application code must import `env` from `@/server/env` instead.
 */

const siteEnvSchema = z.enum(["development", "preview", "production"]);

export type SiteEnv = z.infer<typeof siteEnvSchema>;

export type EmailTransport = "file" | "log" | "resend";

export type PaymentGatewayKind = "razorpay" | "fake";

export interface RazorpayConfig {
  /** Public key id, safe to render into the checkout page. */
  readonly keyId: string;
  /** Never log or expose it. */
  readonly keySecret: string;
  /** Current webhook secret first, then the previous one during rotation. */
  readonly webhookSecrets: readonly string[];
}

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
  readonly payments: {
    /**
     * `fake` is refused in production and is the default only in development;
     * preview must opt in explicitly. Backs development, tests and CI.
     */
    readonly gateway: PaymentGatewayKind;
    /**
     * Null until both key id and secret are set; the schema then also
     * requires the webhook secret, so a non-null configuration can always
     * verify deliveries. A build never needs credentials; a production server
     * refuses to start without them (`src/server/payments/readiness.ts`,
     * called from instrumentation).
     */
    readonly razorpay: RazorpayConfig | null;
  };
  /** Bearer secret the scheduled job routes require; null disables them. */
  readonly cronSecret: string | null;
  readonly notifications: {
    /** Inbox that receives new-order and operations alerts (P10); null disables them. */
    readonly ownerEmail: string | null;
  };
  readonly admin: {
    /** Encrypts staff TOTP secrets; null means no staff can sign in to the admin. Never log it. */
    readonly totpKey: Buffer | null;
    /** Accepted for decryption during rotation. */
    readonly totpKeyPrevious: Buffer | null;
  };
  /** Null until all three variables are set; uploads are unavailable, nothing fails at build. */
  readonly cloudinary: {
    readonly cloudName: string;
    readonly apiKey: string;
    readonly apiSecret: string;
    /** A signed upload preset that caps bytes and dimensions at Cloudinary (docs/admin.md §5.2). */
    readonly uploadPreset: string | null;
  } | null;
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

/** 32 random bytes, base64url (43 characters); the value is never echoed. */
const totpKeySchema = z.string().refine((value) => {
  try {
    return Buffer.from(value, "base64url").length === 32;
  } catch {
    return false;
  }
}, "must be 32 random bytes encoded as base64url");

/**
 * The database name in a connection string, or null when the URL does not
 * parse or names no database. Only the name is ever used in messages.
 */
export function databaseNameOf(databaseUrl: string): string | null {
  try {
    const name = new URL(databaseUrl).pathname.replace(/^\/+/, "");
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/** Database names a preview deployment may use; production data never carries them. */
const PREVIEW_DATABASE_SUFFIXES = ["_preview", "_test"] as const;

export function isPreviewDatabaseName(name: string): boolean {
  return PREVIEW_DATABASE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/** The mode a Razorpay key id belongs to, or null when it is not a key id at all. */
export function razorpayKeyMode(keyId: string): "test" | "live" | null {
  const match = /^rzp_(test|live)_[A-Za-z0-9]+$/.exec(keyId);
  if (!match) return null;
  return match[1] === "live" ? "live" : "test";
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
    PAYMENT_GATEWAY: optionalString.pipe(
      z.enum(["razorpay", "fake"]).optional(),
    ),
    RAZORPAY_KEY_ID: optionalString,
    RAZORPAY_KEY_SECRET: optionalString,
    RAZORPAY_WEBHOOK_SECRET: optionalString,
    RAZORPAY_WEBHOOK_SECRET_PREVIOUS: optionalString,
    CRON_SECRET: optionalString.pipe(
      z
        .string()
        .min(16, "CRON_SECRET must be at least 16 characters")
        .optional(),
    ),
    ORDER_NOTIFY_EMAIL: optionalString.pipe(
      z.email("ORDER_NOTIFY_EMAIL must be an email address").optional(),
    ),
    ADMIN_TOTP_KEY: optionalString.pipe(totpKeySchema.optional()),
    ADMIN_TOTP_KEY_PREVIOUS: optionalString.pipe(totpKeySchema.optional()),
    CLOUDINARY_CLOUD_NAME: optionalString,
    CLOUDINARY_API_KEY: optionalString,
    CLOUDINARY_API_SECRET: optionalString,
    CLOUDINARY_UPLOAD_PRESET: optionalString,
  })
  .superRefine((value, ctx) => {
    // Razorpay credentials, in every environment: the key id tells the mode
    // (rzp_test_ / rzp_live_), and live credentials belong to production only.
    const production = value.SITE_ENV === "production";
    const keyId = value.RAZORPAY_KEY_ID;
    if (keyId !== undefined) {
      const mode = razorpayKeyMode(keyId);
      if (mode === null) {
        ctx.addIssue({
          code: "custom",
          path: ["RAZORPAY_KEY_ID"],
          message:
            "RAZORPAY_KEY_ID must be a Razorpay key id (rzp_test_… or rzp_live_…)",
        });
      } else if (production && mode !== "live") {
        ctx.addIssue({
          code: "custom",
          path: ["RAZORPAY_KEY_ID"],
          message:
            "RAZORPAY_KEY_ID must be a live key (rzp_live_…) in production",
        });
      } else if (!production && mode !== "test") {
        ctx.addIssue({
          code: "custom",
          path: ["RAZORPAY_KEY_ID"],
          message:
            "RAZORPAY_KEY_ID must be a test key (rzp_test_…) outside production; live credentials are refused in development and preview",
        });
      }
    }
    if ((keyId === undefined) !== (value.RAZORPAY_KEY_SECRET === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["RAZORPAY_KEY_ID"],
        message:
          "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set together (one without the other is a misconfiguration)",
      });
    }
    // The keys make online checkout available; without the webhook secret
    // every delivery would be rejected, so the three are one unit in every
    // stage. Deployments without any credentials are untouched by this rule.
    // `optionalString` trims, so a blank secret arrives as "" here.
    if (
      keyId !== undefined &&
      value.RAZORPAY_KEY_SECRET !== undefined &&
      !value.RAZORPAY_WEBHOOK_SECRET
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["RAZORPAY_WEBHOOK_SECRET"],
        message:
          "RAZORPAY_WEBHOOK_SECRET must be set together with the Razorpay keys (webhook deliveries cannot be verified without it)",
      });
    }

    // A preview deployment (SITE_ENV or VERCEL_ENV) may only run against an
    // isolated database, whatever the gateway: the fake gateway would mark
    // real orders paid, and even Razorpay test mode would create real orders.
    // The suffix is a configuration safeguard, not proof of identity; the
    // URL itself must point at a separate database (docs/environments.md).
    if (value.SITE_ENV === "preview") {
      const name = databaseNameOf(value.DATABASE_URL);
      if (name === null || !isPreviewDatabaseName(name)) {
        ctx.addIssue({
          code: "custom",
          path: ["DATABASE_URL"],
          message:
            "DATABASE_URL must name an isolated database for a preview deployment (name ending in _preview or _test); previews never run against production data",
        });
      }
    }

    if (!production) return;

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

    // Signed uploads must be capped at Cloudinary itself, not only in the browser.
    if (
      value.CLOUDINARY_CLOUD_NAME &&
      value.CLOUDINARY_API_KEY &&
      value.CLOUDINARY_API_SECRET &&
      !value.CLOUDINARY_UPLOAD_PRESET
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["CLOUDINARY_UPLOAD_PRESET"],
        message:
          "CLOUDINARY_UPLOAD_PRESET (a signed preset enforcing size and dimension limits) is required in production",
      });
    }

    // The fake payment gateway accepts anything; it must never reach production.
    if (value.PAYMENT_GATEWAY === "fake") {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENT_GATEWAY"],
        message: "PAYMENT_GATEWAY must be razorpay in production",
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
    PAYMENT_GATEWAY: source.PAYMENT_GATEWAY,
    RAZORPAY_KEY_ID: source.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: source.RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: source.RAZORPAY_WEBHOOK_SECRET,
    RAZORPAY_WEBHOOK_SECRET_PREVIOUS: source.RAZORPAY_WEBHOOK_SECRET_PREVIOUS,
    CRON_SECRET: source.CRON_SECRET,
    ORDER_NOTIFY_EMAIL: source.ORDER_NOTIFY_EMAIL,
    ADMIN_TOTP_KEY: source.ADMIN_TOTP_KEY,
    ADMIN_TOTP_KEY_PREVIOUS: source.ADMIN_TOTP_KEY_PREVIOUS,
    CLOUDINARY_CLOUD_NAME: source.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: source.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: source.CLOUDINARY_API_SECRET,
    CLOUDINARY_UPLOAD_PRESET: source.CLOUDINARY_UPLOAD_PRESET,
  });

  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${z.prettifyError(result.error)}`,
    );
  }

  const production = result.data.SITE_ENV === "production";
  const transport =
    result.data.EMAIL_TRANSPORT ?? (production ? "resend" : "file");
  // The fake gateway is the default only on a developer's machine. Preview
  // and production default to the real gateway; a preview that wants the
  // in-process gateway must say so (PAYMENT_GATEWAY=fake), and production
  // refuses it above.
  const gateway =
    result.data.PAYMENT_GATEWAY ??
    (result.data.SITE_ENV === "development" ? "fake" : "razorpay");
  const razorpay =
    result.data.RAZORPAY_KEY_ID && result.data.RAZORPAY_KEY_SECRET
      ? {
          keyId: result.data.RAZORPAY_KEY_ID,
          keySecret: result.data.RAZORPAY_KEY_SECRET,
          webhookSecrets: [
            result.data.RAZORPAY_WEBHOOK_SECRET,
            result.data.RAZORPAY_WEBHOOK_SECRET_PREVIOUS,
          ].filter((secret): secret is string => Boolean(secret)),
        }
      : null;

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
    payments: { gateway, razorpay },
    cronSecret: result.data.CRON_SECRET ?? null,
    notifications: { ownerEmail: result.data.ORDER_NOTIFY_EMAIL ?? null },
    admin: {
      totpKey: result.data.ADMIN_TOTP_KEY
        ? Buffer.from(result.data.ADMIN_TOTP_KEY, "base64url")
        : null,
      totpKeyPrevious: result.data.ADMIN_TOTP_KEY_PREVIOUS
        ? Buffer.from(result.data.ADMIN_TOTP_KEY_PREVIOUS, "base64url")
        : null,
    },
    cloudinary:
      result.data.CLOUDINARY_CLOUD_NAME &&
      result.data.CLOUDINARY_API_KEY &&
      result.data.CLOUDINARY_API_SECRET
        ? {
            cloudName: result.data.CLOUDINARY_CLOUD_NAME,
            apiKey: result.data.CLOUDINARY_API_KEY,
            apiSecret: result.data.CLOUDINARY_API_SECRET,
            uploadPreset: result.data.CLOUDINARY_UPLOAD_PRESET ?? null,
          }
        : null,
  };
}
