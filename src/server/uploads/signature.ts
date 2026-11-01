import { createHash } from "node:crypto";

/**
 * Cloudinary request and response signing (pure; docs/admin.md §5.2, A4).
 * A request signature is SHA-1 over the sorted `key=value` pairs joined by
 * `&`, followed by the API secret. The upload response carries
 * `signature = sha1("public_id=…&version=…" + secret)`, which is how an
 * attach request proves the asset really came from our account.
 */

export type SignableParams = Readonly<
  Record<string, string | number | boolean>
>;

export function serializeParams(params: SignableParams): string {
  return Object.keys(params)
    .filter((key) => params[key] !== "" && params[key] !== undefined)
    .sort()
    .map((key) => `${key}=${String(params[key])}`)
    .join("&");
}

export function signParams(params: SignableParams, apiSecret: string): string {
  return createHash("sha1")
    .update(`${serializeParams(params)}${apiSecret}`)
    .digest("hex");
}

export function expectedResponseSignature(
  publicId: string,
  version: string | number,
  apiSecret: string,
): string {
  return createHash("sha1")
    .update(`public_id=${publicId}&version=${String(version)}${apiSecret}`)
    .digest("hex");
}

/** Public ids we are allowed to touch: inside our folder, no traversal, no odd characters. */
export function isWithinUploadFolder(
  publicId: string,
  folder: string,
): boolean {
  if (!publicId.startsWith(`${folder}/`)) return false;
  const rest = publicId.slice(folder.length + 1);
  return /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(rest);
}
