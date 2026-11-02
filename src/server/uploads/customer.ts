import "server-only";

import { randomBytes } from "node:crypto";

import { getReturnsPolicy } from "@/config/returns-policy";
import type { Prisma } from "@/generated/prisma/client";
import type { UploadPurpose } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/server/auth/current-user";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { rateLimitKey } from "@/server/auth/rate-limit-rules";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";

import {
  expectedResponseSignature,
  isWithinUploadFolder,
  signParams,
} from "./signature";

/**
 * Private customer uploads (docs/phase-8-returns-custom-artwork.md §8.3):
 * the same ticket → verify → ledger pattern as product images, with
 * `type=authenticated` so Cloudinary never serves the asset without a
 * signature, and ownership recorded on the ledger row. Attaching a verified
 * upload to a request is the returns service's job.
 */

export class CustomerUploadError extends AppError {
  constructor(message: string, code: string, status = 400) {
    super(message, { code, status });
  }
}

export interface CustomerUploadTicket {
  readonly uploadId: string;
  readonly cloudName: string;
  readonly apiKey: string;
  readonly uploadUrl: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly signature: string;
  readonly timestamp: number;
  readonly publicId: string;
  readonly maxBytes: number;
  readonly formats: readonly string[];
}

function randomSegment(): string {
  return randomBytes(9)
    .toString("base64url")
    .replace(/[^A-Za-z0-9_-]/g, "");
}

/** Records the intent, then signs exactly what the browser will send. */
export async function issueCustomerUploadTicket(
  user: CurrentUser,
  purpose: Extract<UploadPurpose, "RETURN_EVIDENCE">,
  now = new Date(),
): Promise<CustomerUploadTicket> {
  const config = env.cloudinary;
  if (!config) {
    throw new CustomerUploadError(
      "Photo uploads are not available on this server right now.",
      "UPLOADS_NOT_CONFIGURED",
      503,
    );
  }
  const policy = getReturnsPolicy();
  const limit = await consumeRateLimit(
    rateLimitKey("returns:upload", user.id),
    policy.limits.uploadPerUser,
    now.getTime(),
  );
  if (!limit.allowed) {
    throw new CustomerUploadError(
      "Too many uploads today. Please try again later.",
      "UPLOAD_RATE_LIMITED",
      429,
    );
  }
  const folder = `${policy.files.folder}/${user.id}`;
  const publicId = `${folder}/${randomSegment()}`;
  const row = await db.customerUpload.create({
    data: {
      purpose,
      ownerUserId: user.id,
      publicId,
      folder,
      deliveryType: policy.files.deliveryType,
      status: "ISSUED",
      issuedAt: now,
    },
    select: { id: true, publicId: true },
  });
  const timestamp = Math.floor(now.getTime() / 1000); // policy-literal-ok: ms → s
  const fields: Record<string, string> = {
    timestamp: String(timestamp),
    folder,
    public_id: row.publicId,
    type: policy.files.deliveryType,
    allowed_formats: policy.evidence.formats.join(","),
    transformation: `c_limit,w_${policy.evidence.maxDimension},h_${policy.evidence.maxDimension}`,
  };
  if (config.uploadPreset) fields.upload_preset = config.uploadPreset;
  return {
    uploadId: row.id,
    cloudName: config.cloudName,
    apiKey: config.apiKey,
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`,
    fields,
    signature: signParams(fields, config.apiSecret),
    timestamp,
    publicId: row.publicId,
    maxBytes: policy.evidence.maxBytes,
    formats: policy.evidence.formats,
  };
}

export interface CustomerUploadFacts {
  readonly uploadId: string;
  readonly publicId: string;
  readonly version: string;
  readonly signature: string;
  readonly format: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly resourceType: string;
}

/**
 * Trust nothing from the browser except what Cloudinary signed: the
 * response signature proves the asset came from our account; the facts are
 * then checked against the policy and the ledger row's owner and folder.
 */
export async function verifyCustomerUpload(
  user: CurrentUser,
  facts: CustomerUploadFacts,
  now = new Date(),
  tx: Prisma.TransactionClient = db,
): Promise<{ uploadId: string }> {
  const config = env.cloudinary;
  if (!config) {
    throw new CustomerUploadError(
      "Photo uploads are not available on this server right now.",
      "UPLOADS_NOT_CONFIGURED",
      503,
    );
  }
  const policy = getReturnsPolicy();
  const row = await tx.customerUpload.findFirst({
    where: {
      id: facts.uploadId,
      ownerUserId: user.id,
      status: "ISSUED",
      verifiedAt: null,
    },
    select: { id: true, publicId: true, folder: true },
  });
  if (!row || row.publicId !== facts.publicId) {
    throw new CustomerUploadError(
      "That upload was not started from this account.",
      "UPLOAD_NOT_OWNED",
      404,
    );
  }
  if (
    expectedResponseSignature(
      facts.publicId,
      facts.version,
      config.apiSecret,
    ) !== facts.signature
  ) {
    throw new CustomerUploadError(
      "The upload response signature is not valid.",
      "UPLOAD_SIGNATURE_INVALID",
    );
  }
  if (facts.resourceType !== "image") {
    throw new CustomerUploadError(
      "Only images can be added.",
      "UPLOAD_NOT_IMAGE",
    );
  }
  if (!policy.evidence.formats.includes(facts.format)) {
    throw new CustomerUploadError(
      `Format ${facts.format} is not allowed.`,
      "UPLOAD_FORMAT",
    );
  }
  if (facts.bytes > policy.evidence.maxBytes) {
    throw new CustomerUploadError(
      "The photo is larger than allowed.",
      "UPLOAD_TOO_LARGE",
    );
  }
  const { minDimension, maxDimension } = policy.evidence;
  if (
    facts.width < minDimension ||
    facts.height < minDimension ||
    facts.width > maxDimension ||
    facts.height > maxDimension
  ) {
    throw new CustomerUploadError(
      `Photos must be between ${minDimension} and ${maxDimension} pixels on each side.`,
      "UPLOAD_DIMENSIONS",
    );
  }
  if (!isWithinUploadFolder(facts.publicId, row.folder)) {
    throw new CustomerUploadError(
      "That asset is not in your upload folder.",
      "UPLOAD_FOLDER",
    );
  }
  const verified = await tx.customerUpload.updateMany({
    where: { id: row.id, status: "ISSUED", verifiedAt: null },
    data: {
      format: facts.format,
      bytes: facts.bytes,
      width: facts.width,
      height: facts.height,
      verifiedAt: now,
    },
  });
  if (verified.count !== 1) {
    throw new CustomerUploadError(
      "That upload was already confirmed.",
      "UPLOAD_ALREADY_VERIFIED",
      409,
    );
  }
  return { uploadId: row.id };
}
