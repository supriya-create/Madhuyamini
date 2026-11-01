import "server-only";

import { env } from "@/server/env";
import { AppError } from "@/server/errors";

import { signParams } from "./signature";

/**
 * The few Cloudinary calls the application makes itself (docs/admin.md
 * §5.2, A4): deleting an asset by public id. Uploads go browser → Cloudinary
 * with a server-issued signature (step 5); nothing here proxies image bytes.
 */

export class CloudinaryError extends AppError {
  constructor(
    message: string,
    options: { retryable: boolean; cause?: unknown },
  ) {
    super(message, {
      code: options.retryable
        ? "CLOUDINARY_UNAVAILABLE"
        : "CLOUDINARY_REJECTED",
      status: options.retryable ? 503 : 502,
      cause: options.cause,
    });
  }
}

export function cloudinaryConfig(): NonNullable<typeof env.cloudinary> {
  if (!env.cloudinary) {
    throw new CloudinaryError("Cloudinary is not configured on this server.", {
      retryable: false,
    });
  }
  return env.cloudinary;
}

export type DestroyOutcome = "deleted" | "not_found";

/** Deletes one asset (idempotent: a second call reports `not_found`). */
export async function destroyCloudinaryImage(
  publicId: string,
  options: { readonly fetch?: typeof fetch; readonly now?: Date } = {},
): Promise<DestroyOutcome> {
  const config = cloudinaryConfig();
  const doFetch = options.fetch ?? fetch;
  const timestamp = Math.floor((options.now ?? new Date()).getTime() / 1000); // policy-literal-ok: ms → s
  const params = { public_id: publicId, timestamp, invalidate: true };
  const body = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    invalidate: "true",
    api_key: config.apiKey,
    signature: signParams(params, config.apiSecret),
  });
  let response: Response;
  try {
    response = await doFetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/destroy`,
      { method: "POST", body },
    );
  } catch (cause) {
    throw new CloudinaryError("Cloudinary could not be reached.", {
      retryable: true,
      cause,
    });
  }
  if (response.status >= 500 || response.status === 429) {
    throw new CloudinaryError(`Cloudinary answered ${response.status}.`, {
      retryable: true,
    });
  }
  if (!response.ok) {
    throw new CloudinaryError(
      `Cloudinary rejected the delete (${response.status}).`,
      {
        retryable: false,
      },
    );
  }
  const json = (await response.json()) as { result?: unknown };
  if (json.result === "ok") return "deleted";
  if (json.result === "not found") return "not_found";
  throw new CloudinaryError("Cloudinary returned an unexpected result.", {
    retryable: false,
  });
}
