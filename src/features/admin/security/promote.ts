import type { Prisma } from "@/generated/prisma/client";
import type { AppPrismaClient } from "@/server/prisma-client";

/**
 * First-admin promotion (docs/admin.md §13, A9). Shell only, never over
 * HTTP; the script wraps this with the typed-confirmation prompt. Kept free
 * of `server-only` and the env singleton so the script and the integration
 * tests can run it with their own clients.
 */

export interface PromoteInput {
  readonly email: string;
  /** Required when the database is not local or SITE_ENV is production. */
  readonly confirm: string | null;
  readonly databaseUrl: string;
  readonly siteEnv: string | undefined;
  readonly host: string;
  readonly now?: Date;
}

export type PromoteOutcome =
  | {
      readonly kind: "promoted";
      readonly userId: string;
      readonly sessionsRevoked: number;
    }
  | { readonly kind: "already_admin"; readonly userId: string };

export class PromoteError extends Error {
  readonly code:
    "CONFIRMATION_REQUIRED" | "USER_NOT_FOUND" | "EMAIL_NOT_VERIFIED";

  constructor(code: PromoteError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLocalDatabase(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export async function promoteToAdmin(
  prisma: AppPrismaClient | Prisma.TransactionClient,
  input: PromoteInput,
): Promise<PromoteOutcome> {
  const email = input.email.trim().toLowerCase();
  const now = input.now ?? new Date();
  const guarded =
    input.siteEnv === "production" || !isLocalDatabase(input.databaseUrl);
  if (guarded && input.confirm !== email) {
    throw new PromoteError(
      "CONFIRMATION_REQUIRED",
      "This database is not local: set ADMIN_PROMOTE_CONFIRM to the same email for this invocation.",
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, emailVerified: true },
  });
  if (!user)
    throw new PromoteError("USER_NOT_FOUND", "No account with that email.");
  if (!user.emailVerified) {
    throw new PromoteError(
      "EMAIL_NOT_VERIFIED",
      "The account must confirm its email address before it can be promoted.",
    );
  }

  const actorLabel = `script:promote-admin@${input.host}`;
  if (user.role === "ADMIN") {
    await prisma.adminAuditLog.create({
      data: {
        actorLabel,
        action: "user.role.set",
        targetType: "user",
        targetId: user.id,
        outcome: "SUCCESS",
        reason: "already ADMIN; no change",
        before: { id: user.id, role: user.role },
        after: { id: user.id, role: user.role },
        createdAt: now,
      },
    });
    return { kind: "already_admin", userId: user.id };
  }

  const run = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('user-roles'))`;
    await tx.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    const sessions = await tx.session.deleteMany({
      where: { userId: user.id },
    });
    await tx.adminAuditLog.create({
      data: {
        actorLabel,
        action: "user.role.set",
        targetType: "user",
        targetId: user.id,
        outcome: "SUCCESS",
        reason: "promote-admin script",
        before: { id: user.id, role: user.role },
        after: { id: user.id, role: "ADMIN" },
        createdAt: now,
      },
    });
    return {
      kind: "promoted" as const,
      userId: user.id,
      sessionsRevoked: sessions.count,
    };
  };
  return "$transaction" in prisma ? prisma.$transaction(run) : run(prisma);
}
