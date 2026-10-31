"use client";

import type { ImageLoaderProps } from "next/image";

const CLOUDINARY_HOST = "res.cloudinary.com";
const UPLOAD_SEGMENT = "/image/upload/";

/**
 * Builds a Cloudinary delivery URL with format/quality negotiation and a
 * width limit inserted after `/image/upload/`. Non-Cloudinary URLs are
 * returned unchanged, so local and development images still render.
 */
export function buildImageUrl({
  src,
  width,
  quality,
}: ImageLoaderProps): string {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return src;
  }
  if (
    url.hostname !== CLOUDINARY_HOST ||
    !url.pathname.includes(UPLOAD_SEGMENT)
  )
    return src;

  const [prefix, rest] = url.pathname.split(UPLOAD_SEGMENT, 2);
  if (rest === undefined) return src;
  // Strip any transformation segment already present so ours is authoritative.
  const publicPath = rest.replace(/^(?:[a-z]{1,3}_[^/]+\/)+/u, "");
  const transforms = [
    "f_auto",
    `q_auto${quality ? `:${quality}` : ""}`,
    `w_${width}`,
    "c_limit",
  ];
  url.pathname = `${prefix}${UPLOAD_SEGMENT}${transforms.join(",")}/${publicPath}`;
  return url.toString();
}

export default function imageLoader(props: ImageLoaderProps): string {
  return buildImageUrl(props);
}
