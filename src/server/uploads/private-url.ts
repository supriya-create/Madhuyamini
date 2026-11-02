import { createHash } from "node:crypto";

/**
 * Signed delivery URLs for `authenticated` Cloudinary assets (pure). The
 * signature covers the transformation and the public id with its format,
 * never the version: `s--` + the first 8 characters of the URL-safe base64
 * SHA-1 of `${transformation}/${publicId}.${format}` + the API secret
 * (Cloudinary's SDK `url()` with `sign_url`). The URL is built server-side
 * and fetched server-side; the browser only ever sees our own file route.
 */

export interface SignedDeliveryInput {
  readonly cloudName: string;
  readonly apiSecret: string;
  readonly publicId: string;
  readonly format: string;
  readonly version: string | number | null;
  /** Cloudinary transformation string such as `c_limit,w_640`, or null. */
  readonly transformation: string | null;
  readonly type: "authenticated" | "private" | "upload";
}

export function deliverySignature(
  input: Pick<
    SignedDeliveryInput,
    "apiSecret" | "publicId" | "format" | "transformation"
  >,
): string {
  const source = `${input.publicId}.${input.format}`;
  const toSign = [input.transformation, source]
    .filter((part): part is string => Boolean(part))
    .join("/");
  const digest = createHash("sha1")
    .update(`${toSign}${input.apiSecret}`)
    .digest("base64")
    .replace(/\//g, "_")
    .replace(/\+/g, "-");
  return `s--${digest.slice(0, 8)}--`; // policy-literal-ok: Cloudinary short signature length
}

export function signedDeliveryUrl(input: SignedDeliveryInput): string {
  const parts = [
    `https://res.cloudinary.com/${encodeURIComponent(input.cloudName)}/image`,
    input.type,
    deliverySignature(input),
    input.transformation,
    input.version !== null ? `v${String(input.version)}` : null,
    `${input.publicId}.${input.format}`,
  ].filter((part): part is string => Boolean(part));
  return parts.join("/");
}
