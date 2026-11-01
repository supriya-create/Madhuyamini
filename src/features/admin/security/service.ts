import "server-only";

import { verifyPassword } from "better-auth/crypto";

import { getAdminPolicy } from "@/config/admin-policy";
import { minutesToMs } from "@/config/checkout-policy";
import type { Prisma } from "@/generated/prisma/client";
import {
  authRateLimits,
  consumeRateLimit,
  rateLimitKey,
} from "@/server/auth/rate-limit";
import type { CurrentUser } from "@/server/auth/current-user";
import { StaffGateError } from "@/server/auth/staff";
import type { StaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
import {
  enqueueNotification,
  enqueueOpsAlert,
} from "@/server/notifications/outbox";
import {
  base32Encode,
  currentStep,
  decryptSecret,
  encryptSecret,
  findMatchingStep,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUri,
} from "@/server/security/totp";

import { writeAudit } from "../audit";
import type { AuditActor } from "../audit";
import { runAudited } from "../audit";

/**
 * Staff second factor (docs/admin.md §5.9): enrolment that counts only after
 * a code verifies, per-session verification, replay protection by accepted
 * step, one-time recovery codes, rate limits and re-authentication. All of
 * it reuses the Phase 4 limiter and the Phase 6 outbox.
 */

export class TwoFactorError extends AppError {
  constructor(
    message: string,
    code:
      | "TWO_FACTOR_NOT_AVAILABLE"
      | "TWO_FACTOR_NOT_CONFIGURED"
      | "TWO_FACTOR_ALREADY_ENABLED"
      | "TWO_FACTOR_NOT_ENROLLED"
      | "TWO_FACTOR_ENROLMENT_EXPIRED"
      | "TWO_FACTOR_INVALID_CODE"
      | "TWO_FACTOR_PASSWORD"
      | "TWO_FACTOR_RATE_LIMITED",
    status = 400,
  ) {
    super(message, { code, status });
  }
}

const INVALID = () =>
  new TwoFactorError(
    "That code is not valid. Try the next one.",
    "TWO_FACTOR_INVALID_CODE",
  );

function actorOf(user: CurrentUser): AuditActor {
  return {
    actorId: user.id,
    actorLabel: `user:${user.id}`,
    actorRole: user.role,
    sessionId: user.session.id,
  };
}

function keys(): { current: Buffer; previous: Buffer | null } {
  const current = env.admin.totpKey;
  if (!current) {
    throw new TwoFactorError(
      "Second-factor sign-in is not configured on this server.",
      "TWO_FACTOR_NOT_CONFIGURED",
      503,
    );
  }
  return { current, previous: env.admin.totpKeyPrevious };
}

/** Decrypts with the current key, falling back to the previous one during rotation. */
function decryptWithRotation(ciphertext: string): {
  secret: Buffer;
  rotated: boolean;
} {
  const { current, previous } = keys();
  try {
    return { secret: decryptSecret(ciphertext, current), rotated: false };
  } catch (error) {
    if (!previous) throw error;
    return { secret: decryptSecret(ciphertext, previous), rotated: true };
  }
}

/** A secret that still decrypts only under the previous key is re-encrypted on the next acceptance. */
async function reencrypt(
  tx: Prisma.TransactionClient,
  userId: string,
  secret: Buffer,
): Promise<void> {
  await tx.staffTwoFactor.update({
    where: { userId },
    data: {
      secretCiphertext: encryptSecret(secret, keys().current),
      keyVersion: { increment: 1 },
    },
  });
}

function requireStaffRole(user: CurrentUser): void {
  if (user.role === "CUSTOMER") {
    throw new TwoFactorError(
      "Two-factor sign-in is for staff accounts.",
      "TWO_FACTOR_NOT_AVAILABLE",
      404,
    );
  }
}

async function limit(
  key: string,
  rule: { windowSeconds: number; max: number },
  onTrip?: () => Promise<void>,
) {
  const outcome = await consumeRateLimit(key, rule);
  if (!outcome.allowed) {
    if (onTrip) await onTrip().catch(() => undefined);
    throw new TwoFactorError(
      "Too many attempts. Please wait before trying again.",
      "TWO_FACTOR_RATE_LIMITED",
      429,
    );
  }
}

/**
 * Enrolment starts with the account's password (docs/admin.md §5.9), so a
 * hijacked session alone cannot bind a new authenticator. Shares the
 * sign-in limiter, and leaves a REFUSED audit row on a wrong password.
 */
async function requirePassword(
  user: CurrentUser,
  password: string,
): Promise<void> {
  const outcome = await consumeRateLimit(
    rateLimitKey("sign-in:email", user.email),
    authRateLimits.signInByEmail,
  );
  if (!outcome.allowed) {
    throw new TwoFactorError(
      "Too many attempts. Please wait before trying again.",
      "TWO_FACTOR_RATE_LIMITED",
      429,
    );
  }
  const account = await db.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
    select: { password: true },
  });
  const valid =
    typeof account?.password === "string" &&
    (await verifyPassword({ hash: account.password, password }));
  if (!valid) {
    await writeAudit({
      actor: actorOf(user),
      action: "security.two_factor.begin",
      targetType: "two_factor",
      targetId: user.id,
      outcome: "REFUSED",
      errorCode: "TWO_FACTOR_PASSWORD",
    });
    throw new TwoFactorError(
      "That password is not right.",
      "TWO_FACTOR_PASSWORD",
      403,
    );
  }
}

async function alertRecoveryLimit(user: CurrentUser, now: Date): Promise<void> {
  const windowMs = getAdminPolicy().limits.recoveryPerUser.windowSeconds * 1000; // policy-literal-ok: s → ms
  const windowStart = Math.floor(now.getTime() / windowMs);
  await db.$transaction((tx) =>
    enqueueOpsAlert(tx, {
      key: `recovery-limit:${user.id}:${windowStart}`,
      orderId: null,
      payload: {
        reason: "Repeated recovery-code attempts on a staff account",
        userId: user.id,
      },
    }),
  );
}

export interface EnrolmentStart {
  /** Shown once, as text for "enter a setup key" and as an otpauth link. */
  readonly secretBase32: string;
  readonly uri: string;
}

/** Creates (or replaces) a pending enrolment; nothing counts until confirmed. */
export async function beginEnrolment(
  user: CurrentUser,
  password: string,
  now = new Date(),
): Promise<EnrolmentStart> {
  requireStaffRole(user);
  const policy = getAdminPolicy();
  await limit(
    rateLimitKey("two-factor:enrol", user.id),
    policy.limits.enrolmentPerUser,
  );
  const { current } = keys();
  await requirePassword(user, password);

  const existing = await db.staffTwoFactor.findUnique({
    where: { userId: user.id },
    select: { enabledAt: true },
  });
  if (existing?.enabledAt) {
    throw new TwoFactorError(
      "Two-factor sign-in is already set up. Ask an admin to reset it if you lost your device.",
      "TWO_FACTOR_ALREADY_ENABLED",
      409,
    );
  }

  const secret = generateTotpSecret(policy.totp.secretBytes);
  await db.$transaction(async (tx) => {
    await tx.staffTwoFactor.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        secretCiphertext: encryptSecret(secret, current),
        keyVersion: 1,
        createdAt: now,
      },
      update: {
        secretCiphertext: encryptSecret(secret, current),
        keyVersion: 1,
        enabledAt: null,
        lastAcceptedStep: null,
        createdAt: now,
      },
    });
    await writeAudit(
      {
        actor: actorOf(user),
        action: "security.two_factor.begin",
        targetType: "two_factor",
        targetId: user.id,
        outcome: "SUCCESS",
      },
      tx,
    );
  });
  return {
    secretBase32: base32Encode(secret),
    uri: otpauthUri({
      issuer: policy.totp.issuer,
      account: user.email,
      secret,
      digits: policy.totp.digits,
      periodSeconds: policy.totp.periodSeconds,
    }),
  };
}

/** The pending enrolment's secret, for the enrolment page only (never once enabled). */
export async function pendingEnrolment(
  user: CurrentUser,
  now = new Date(),
): Promise<EnrolmentStart | null> {
  requireStaffRole(user);
  const policy = getAdminPolicy();
  const row = await db.staffTwoFactor.findUnique({
    where: { userId: user.id },
  });
  if (!row || row.enabledAt) return null;
  if (
    now.getTime() - row.createdAt.getTime() >
    minutesToMs(policy.sessions.enrolmentMinutes)
  )
    return null;
  const { secret } = decryptWithRotation(row.secretCiphertext);
  return {
    secretBase32: base32Encode(secret),
    uri: otpauthUri({
      issuer: policy.totp.issuer,
      account: user.email,
      secret,
      digits: policy.totp.digits,
      periodSeconds: policy.totp.periodSeconds,
    }),
  };
}

export interface EnrolmentConfirmed {
  /** Shown once; stored only as hashes. */
  readonly recoveryCodes: readonly string[];
}

/**
 * Enrolment verification: the first valid code enables the factor, issues
 * recovery codes and verifies the current session, all in one transaction
 * keyed on `enabled_at IS NULL`.
 */
export async function confirmEnrolment(
  user: CurrentUser,
  code: string,
  now = new Date(),
): Promise<EnrolmentConfirmed> {
  requireStaffRole(user);
  const policy = getAdminPolicy();
  await limit(
    rateLimitKey("two-factor:totp", user.id),
    policy.limits.totpPerUser,
  );
  const row = await db.staffTwoFactor.findUnique({
    where: { userId: user.id },
  });
  if (!row)
    throw new TwoFactorError(
      "Start the setup first.",
      "TWO_FACTOR_NOT_ENROLLED",
    );
  if (row.enabledAt) {
    throw new TwoFactorError(
      "Already set up.",
      "TWO_FACTOR_ALREADY_ENABLED",
      409,
    );
  }
  if (
    now.getTime() - row.createdAt.getTime() >
    minutesToMs(policy.sessions.enrolmentMinutes)
  ) {
    throw new TwoFactorError(
      "This setup has expired. Start again to get a new key.",
      "TWO_FACTOR_ENROLMENT_EXPIRED",
    );
  }
  const { secret, rotated } = decryptWithRotation(row.secretCiphertext);
  const step = findMatchingStep(secret, code, now, policy.totp);
  if (step === null) {
    await writeAudit({
      actor: actorOf(user),
      action: "security.two_factor.confirm",
      targetType: "two_factor",
      targetId: user.id,
      outcome: "REFUSED",
      errorCode: "TWO_FACTOR_INVALID_CODE",
    });
    throw INVALID();
  }

  const plainCodes = generateRecoveryCodes(
    policy.recovery.codeCount,
    policy.recovery.codeLength,
  );
  await db.$transaction(async (tx) => {
    const enabled = await tx.staffTwoFactor.updateMany({
      where: { userId: user.id, enabledAt: null },
      data: { enabledAt: now, lastAcceptedStep: step },
    });
    if (enabled.count !== 1) {
      throw new TwoFactorError(
        "Already set up.",
        "TWO_FACTOR_ALREADY_ENABLED",
        409,
      );
    }
    if (rotated) await reencrypt(tx, user.id, secret);
    await tx.staffRecoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.staffRecoveryCode.createMany({
      data: plainCodes.map((plain) => ({
        userId: user.id,
        codeHash: hashRecoveryCode(plain, user.id),
      })),
    });
    await verifySession(tx, user, "TOTP", now);
    await writeAudit(
      {
        actor: actorOf(user),
        action: "security.two_factor.confirm",
        targetType: "two_factor",
        targetId: user.id,
        outcome: "SUCCESS",
        after: {
          userId: user.id,
          enabled: true,
          recoveryCodesRemaining: plainCodes.length,
        },
      },
      tx,
    );
  });
  return { recoveryCodes: plainCodes };
}

/**
 * A fresh set of recovery codes, on a fresh TOTP code (docs/admin.md §5.9):
 * the old set is invalidated in the same transaction. The code is subject
 * to the same replay rule as sign-in.
 */
export async function regenerateRecoveryCodes(
  user: CurrentUser,
  code: string,
  now = new Date(),
): Promise<EnrolmentConfirmed> {
  requireStaffRole(user);
  const policy = getAdminPolicy();
  await limit(
    rateLimitKey("two-factor:totp", user.id),
    policy.limits.totpPerUser,
  );
  const row = await db.staffTwoFactor.findUnique({
    where: { userId: user.id },
  });
  if (!row?.enabledAt) throw new StaffGateError("not_enrolled");
  const { secret, rotated } = decryptWithRotation(row.secretCiphertext);
  const step = findMatchingStep(secret, code, now, policy.totp);
  const actor = actorOf(user);
  const refused = (errorCode: string) =>
    writeAudit({
      actor,
      action: "security.recovery_codes.regenerate",
      targetType: "two_factor",
      targetId: user.id,
      outcome: "REFUSED",
      errorCode,
    });
  if (step === null) {
    await refused("TWO_FACTOR_INVALID_CODE");
    throw INVALID();
  }
  const plainCodes = generateRecoveryCodes(
    policy.recovery.codeCount,
    policy.recovery.codeLength,
  );
  const accepted = await db.$transaction(async (tx) => {
    const moved = await tx.staffTwoFactor.updateMany({
      where: {
        userId: user.id,
        OR: [{ lastAcceptedStep: null }, { lastAcceptedStep: { lt: step } }],
      },
      data: { lastAcceptedStep: step },
    });
    if (moved.count !== 1) return false;
    if (rotated) await reencrypt(tx, user.id, secret);
    await tx.staffRecoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.staffRecoveryCode.createMany({
      data: plainCodes.map((plain) => ({
        userId: user.id,
        codeHash: hashRecoveryCode(plain, user.id),
      })),
    });
    await writeAudit(
      {
        actor,
        action: "security.recovery_codes.regenerate",
        targetType: "two_factor",
        targetId: user.id,
        outcome: "SUCCESS",
        after: {
          userId: user.id,
          enabled: true,
          recoveryCodesRemaining: plainCodes.length,
        },
      },
      tx,
    );
    return true;
  });
  if (!accepted) {
    await refused("TWO_FACTOR_REPLAYED");
    throw INVALID();
  }
  return { recoveryCodes: plainCodes };
}

async function verifySession(
  tx: Prisma.TransactionClient,
  user: CurrentUser,
  method: "TOTP" | "RECOVERY",
  now: Date,
): Promise<void> {
  await tx.staffSessionVerification.upsert({
    where: { sessionId: user.session.id },
    create: {
      sessionId: user.session.id,
      userId: user.id,
      method,
      verifiedAt: now,
    },
    update: { method, verifiedAt: now },
  });
}

export type SecondFactorInput =
  | { readonly kind: "totp"; readonly code: string }
  | { readonly kind: "recovery"; readonly code: string };

/**
 * Verifies THIS session (sign-in and re-authentication alike). Acceptance is
 * one conditional update — one winner among concurrent requests with the
 * same code; recovery codes are consumed the same way.
 */
export async function verifySecondFactor(
  user: CurrentUser,
  input: SecondFactorInput,
  options: { readonly now?: Date; readonly requestIp?: string | null } = {},
): Promise<void> {
  requireStaffRole(user);
  const now = options.now ?? new Date();
  const policy = getAdminPolicy();
  await limit(
    rateLimitKey("two-factor:totp", user.id),
    policy.limits.totpPerUser,
  );
  if (options.requestIp) {
    await limit(
      rateLimitKey("two-factor:ip", options.requestIp),
      policy.limits.totpPerIp,
    );
  }
  const row = await db.staffTwoFactor.findUnique({
    where: { userId: user.id },
  });
  if (!row?.enabledAt) throw new StaffGateError("not_enrolled");
  const actor = actorOf(user);
  const refused = (errorCode: string, action: string) =>
    writeAudit({
      actor,
      action,
      targetType: "two_factor",
      targetId: user.id,
      outcome: "REFUSED",
      errorCode,
      requestIp: options.requestIp,
    });

  if (input.kind === "totp") {
    const { secret, rotated } = decryptWithRotation(row.secretCiphertext);
    const step = findMatchingStep(secret, input.code, now, policy.totp);
    if (step === null) {
      await refused("TWO_FACTOR_INVALID_CODE", "security.two_factor.verify");
      throw INVALID();
    }
    const accepted = await db.$transaction(async (tx) => {
      // Replay protection: the step must advance. Exactly one concurrent
      // request can win this update.
      const moved = await tx.staffTwoFactor.updateMany({
        where: {
          userId: user.id,
          OR: [{ lastAcceptedStep: null }, { lastAcceptedStep: { lt: step } }],
        },
        data: { lastAcceptedStep: step },
      });
      if (moved.count !== 1) return false;
      if (rotated) await reencrypt(tx, user.id, secret);
      await verifySession(tx, user, "TOTP", now);
      await writeAudit(
        {
          actor,
          action: "security.two_factor.verify",
          targetType: "two_factor",
          targetId: user.id,
          outcome: "SUCCESS",
          after: { userId: user.id, method: "TOTP" },
          requestIp: options.requestIp,
        },
        tx,
      );
      return true;
    });
    if (!accepted) {
      await refused("TWO_FACTOR_REPLAYED", "security.two_factor.verify");
      throw INVALID();
    }
    return;
  }

  await limit(
    rateLimitKey("two-factor:recovery", user.id),
    policy.limits.recoveryPerUser,
    // Repeated recovery-code guessing is worth a human's attention.
    () => alertRecoveryLimit(user, now),
  );
  const codeHash = hashRecoveryCode(input.code, user.id);
  const accepted = await db.$transaction(async (tx) => {
    const consumed = await tx.staffRecoveryCode.updateMany({
      where: { userId: user.id, codeHash, usedAt: null },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) return false;
    await verifySession(tx, user, "RECOVERY", now);
    const remaining = await tx.staffRecoveryCode.count({
      where: { userId: user.id, usedAt: null },
    });
    await writeAudit(
      {
        actor,
        action: "security.two_factor.recovery",
        targetType: "two_factor",
        targetId: user.id,
        outcome: "SUCCESS",
        after: {
          userId: user.id,
          method: "RECOVERY",
          recoveryCodesRemaining: remaining,
        },
        requestIp: options.requestIp,
      },
      tx,
    );
    await enqueueNotification(tx, {
      kind: "security.recovery_code_used",
      orderId: null,
      recipient: user.email,
      dedupeKey: `security.recovery_code_used:${user.id}:${now.getTime()}`,
      payload: { remaining },
    });
    await enqueueOpsAlert(tx, {
      key: `recovery-code-used:${user.id}:${now.getTime()}`,
      orderId: null,
      payload: {
        reason: "A staff recovery code was used",
        userId: user.id,
        remaining,
      },
    });
    return true;
  });
  if (!accepted) {
    await refused(
      "TWO_FACTOR_INVALID_RECOVERY",
      "security.two_factor.recovery",
    );
    throw INVALID();
  }
}

export interface SecurityStatus {
  readonly enabled: boolean;
  readonly enabledAt: Date | null;
  readonly pending: boolean;
  readonly recoveryCodesRemaining: number;
  readonly sessionVerifiedAt: Date | null;
}

export async function securityStatus(
  user: CurrentUser,
): Promise<SecurityStatus> {
  const [row, remaining, verification] = await Promise.all([
    db.staffTwoFactor.findUnique({ where: { userId: user.id } }),
    db.staffRecoveryCode.count({ where: { userId: user.id, usedAt: null } }),
    db.staffSessionVerification.findUnique({
      where: { sessionId: user.session.id },
    }),
  ]);
  return {
    enabled: Boolean(row?.enabledAt),
    enabledAt: row?.enabledAt ?? null,
    pending: Boolean(row && !row.enabledAt),
    recoveryCodesRemaining: remaining,
    sessionVerifiedAt: verification?.verifiedAt ?? null,
  };
}

/** ADMIN resets a colleague's second factor so they enrol again (sensitive). */
export async function resetTwoFactor(
  ctx: StaffContext,
  targetUserId: string,
  reason: string,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "security.two_factor.reset",
      targetType: "two_factor",
      targetId: targetUserId,
      capability: "customers.reset_two_factor",
      reason,
      now,
    },
    async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, email: true, role: true },
      });
      if (!target || target.role === "CUSTOMER") {
        throw new TwoFactorError(
          "No staff account found.",
          "TWO_FACTOR_NOT_AVAILABLE",
          404,
        );
      }
      await tx.staffSessionVerification.deleteMany({
        where: { userId: targetUserId },
      });
      await tx.staffRecoveryCode.deleteMany({
        where: { userId: targetUserId },
      });
      await tx.staffTwoFactor.deleteMany({ where: { userId: targetUserId } });
      await enqueueOpsAlert(tx, {
        key: `two-factor-reset:${targetUserId}:${now.getTime()}`,
        orderId: null,
        payload: {
          reason: "A staff second factor was reset",
          userId: targetUserId,
        },
      });
      return {
        result: undefined,
        after: { userId: targetUserId, enabled: false },
      };
    },
  );
}

/** Seconds until the current TOTP step rolls over (for the UI hint only). */
export function secondsUntilNextStep(now = new Date()): number {
  const period = getAdminPolicy().totp.periodSeconds;
  const step = currentStep(now, period);
  const nextAt = (Number(step) + 1) * period * 1000; // policy-literal-ok: s → ms
  return Math.max(1, Math.ceil((nextAt - now.getTime()) / 1000)); // policy-literal-ok: ms → s
}
