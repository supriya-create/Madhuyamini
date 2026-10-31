import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { auth } from "@/server/auth/auth";
import { env } from "@/server/env";

import { firstLink, waitForEmail } from "../support/mailbox";
import { resetDatabase, testDb } from "./db";

/**
 * Verifies Better Auth against this schema and the owner's requirements for
 * D3: existing User model, database sessions, listing and revocation,
 * verification, reset and change flows, server-owned roles, and the HTTP
 * surface being closed except for the verification link.
 */

beforeEach(resetDatabase);
afterAll(() => testDb.$disconnect());

const PASSWORD = "peacock on the pallu";
const customer = {
  name: "Asha Devi",
  email: "asha@example.com",
  password: PASSWORD,
};

async function signIn(email = customer.email, password = PASSWORD) {
  const { headers, response } = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = headers.get("set-cookie");
  if (!cookie) throw new Error("sign-in set no cookie");
  // Keep only name=value pairs, as a browser would send them back.
  const cookieHeader = cookie
    .split(/,(?=[^;]+=)/)
    .map((part) => part.split(";")[0]?.trim() ?? "")
    .join("; ");
  return {
    cookieHeader,
    requestHeaders: new Headers({ cookie: cookieHeader }),
    response,
  };
}

function tokenFromLink(link: string): string {
  const token = new URL(link).searchParams.get("token");
  if (!token) throw new Error(`no token in ${link}`);
  return token;
}

describe("registration", () => {
  it("creates the user in our existing users table with a credential account", async () => {
    await auth.api.signUpEmail({ body: customer });

    const user = await testDb.user.findUniqueOrThrow({
      where: { email: customer.email },
    });
    expect(user).toMatchObject({
      name: "Asha Devi",
      role: "CUSTOMER",
      emailVerified: false,
    });
    const account = await testDb.account.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(account.providerId).toBe("credential");
    expect(account.password).toBeTruthy();
    expect(account.password).not.toContain(PASSWORD);
    expect(await testDb.user.count()).toBe(1);
  });

  it("sends a verification email with a working link", async () => {
    await auth.api.signUpEmail({ body: customer });
    const mail = await waitForEmail(
      env.email.outboxDir,
      customer.email,
      /confirm your email/i,
    );
    const link = firstLink(mail);
    expect(link).toContain("/api/auth/verify-email?token=");

    const response = await auth.handler(new Request(link));
    expect([200, 302]).toContain(response.status);
    const user = await testDb.user.findUniqueOrThrow({
      where: { email: customer.email },
    });
    expect(user.emailVerified).toBe(true);
  });

  it("answers a duplicate email exactly like a new one and creates nothing", async () => {
    const first = await auth.api.signUpEmail({ body: customer });
    const second = await auth.api.signUpEmail({
      body: {
        ...customer,
        name: "Impostor",
        password: "another fine passphrase",
      },
    });
    expect(second.token).toBe(first.token);
    expect(second.user.email).toBe(customer.email);
    expect(await testDb.user.count()).toBe(1);
    const stored = await testDb.user.findUniqueOrThrow({
      where: { email: customer.email },
    });
    expect(stored.name).toBe("Asha Devi");
  });

  it("never lets a client set role or phone at sign-up", async () => {
    await expect(
      auth.api.signUpEmail({
        body: { ...customer, role: "ADMIN" } as typeof customer,
      }),
    ).rejects.toThrow(/role is not allowed/);
    await expect(
      auth.api.signUpEmail({
        body: { ...customer, phone: "+911234567890" } as typeof customer,
      }),
    ).rejects.toThrow(/phone is not allowed/);
    expect(await testDb.user.count()).toBe(0);
  });

  it("applies the password policy to server-side calls too", async () => {
    await expect(
      auth.api.signUpEmail({ body: { ...customer, password: "password123" } }),
    ).rejects.toThrow(/too predictable/);
    await expect(
      auth.api.signUpEmail({
        body: { ...customer, password: "asha@example.com" },
      }),
    ).rejects.toThrow(/cannot be your email/);
    await expect(
      auth.api.signUpEmail({ body: { ...customer, password: "short" } }),
    ).rejects.toThrow();
    expect(await testDb.user.count()).toBe(0);
  });
});

describe("sessions", () => {
  beforeEach(async () => {
    await auth.api.signUpEmail({ body: customer });
  });

  it("signs in with a database-backed session and reports it", async () => {
    const { requestHeaders } = await signIn();
    const session = await auth.api.getSession({ headers: requestHeaders });
    expect(session?.user.email).toBe(customer.email);
    expect(session?.user).toMatchObject({ role: "CUSTOMER" });
    // IP tracking is disabled: nothing identifying is stored (empty string or null).
    expect(session?.session.ipAddress || null).toBeNull();

    const rows = await testDb.session.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token).toBe(session?.session.token);
  });

  it("rejects wrong passwords and unknown emails with the same error", async () => {
    const wrong = auth.api.signInEmail({
      body: { email: customer.email, password: "nope nope nope" },
    });
    const unknown = auth.api.signInEmail({
      body: { email: "nobody@example.com", password: PASSWORD },
    });
    const [wrongError, unknownError] = await Promise.all([
      wrong.catch((error: unknown) => error),
      unknown.catch((error: unknown) => error),
    ]);
    expect(String(wrongError)).toBe(String(unknownError));
  });

  it("lists sessions, revokes one, revokes the others and revokes all", async () => {
    const first = await signIn();
    const second = await signIn();
    const third = await signIn();

    const listed = await auth.api.listSessions({
      headers: first.requestHeaders,
    });
    expect(listed).toHaveLength(3);

    const thirdToken = (
      await auth.api.getSession({ headers: third.requestHeaders })
    )?.session.token;
    if (!thirdToken) throw new Error("expected third session");
    await auth.api.revokeSession({
      headers: first.requestHeaders,
      body: { token: thirdToken },
    });
    expect(
      await auth.api.getSession({ headers: third.requestHeaders }),
    ).toBeNull();
    expect(
      await auth.api.listSessions({ headers: first.requestHeaders }),
    ).toHaveLength(2);

    await auth.api.revokeOtherSessions({ headers: first.requestHeaders });
    expect(
      await auth.api.getSession({ headers: second.requestHeaders }),
    ).toBeNull();
    expect(
      await auth.api.getSession({ headers: first.requestHeaders }),
    ).not.toBeNull();

    await auth.api.revokeSessions({ headers: first.requestHeaders });
    expect(
      await auth.api.getSession({ headers: first.requestHeaders }),
    ).toBeNull();
    expect(await testDb.session.count()).toBe(0);
  });

  it("signs out by deleting the session row", async () => {
    const { requestHeaders } = await signIn();
    await auth.api.signOut({ headers: requestHeaders });
    expect(await testDb.session.count()).toBe(0);
    expect(await auth.api.getSession({ headers: requestHeaders })).toBeNull();
  });
});

describe("password change and reset", () => {
  beforeEach(async () => {
    await auth.api.signUpEmail({ body: customer });
  });

  it("changes the password, revokes other sessions and enforces the policy", async () => {
    const current = await signIn();
    const other = await signIn();

    await expect(
      auth.api.changePassword({
        headers: current.requestHeaders,
        body: {
          currentPassword: PASSWORD,
          newPassword: "qwertyuiop",
          revokeOtherSessions: true,
        },
      }),
    ).rejects.toThrow(/too predictable/);

    const changed = await auth.api.changePassword({
      headers: current.requestHeaders,
      returnHeaders: true,
      body: {
        currentPassword: PASSWORD,
        newPassword: "lotus medallion dupatta",
        revokeOtherSessions: true,
      },
    });
    // The current session is rotated (new cookie) and every other session is gone.
    const rotatedCookie = changed.headers.get("set-cookie");
    expect(rotatedCookie).toBeTruthy();
    const rotatedHeaders = new Headers({
      cookie: (rotatedCookie ?? "")
        .split(/,(?=[^;]+=)/)
        .map((part) => part.split(";")[0]?.trim() ?? "")
        .join("; "),
    });
    expect(
      await auth.api.getSession({ headers: other.requestHeaders }),
    ).toBeNull();
    expect(
      await auth.api.getSession({ headers: current.requestHeaders }),
    ).toBeNull();
    expect(
      await auth.api.getSession({ headers: rotatedHeaders }),
    ).not.toBeNull();
    expect(await testDb.session.count()).toBe(1);
    await expect(signIn(customer.email, PASSWORD)).rejects.toThrow();
    await expect(
      signIn(customer.email, "lotus medallion dupatta"),
    ).resolves.toBeTruthy();
  });

  it("resets the password through a single-use emailed token and signs everyone out", async () => {
    const session = await signIn();
    await auth.api.requestPasswordReset({ body: { email: customer.email } });
    const mail = await waitForEmail(
      env.email.outboxDir,
      customer.email,
      /reset your/i,
    );
    const link = firstLink(mail);
    expect(link).toContain("/reset-password?token=");
    const token = tokenFromLink(link);

    await auth.api.resetPassword({
      body: { newPassword: "kohbar on handmade paper", token },
    });
    expect(
      await auth.api.getSession({ headers: session.requestHeaders }),
    ).toBeNull();
    await expect(
      signIn(customer.email, "kohbar on handmade paper"),
    ).resolves.toBeTruthy();

    await expect(
      auth.api.resetPassword({
        body: { newPassword: "yet another passphrase", token },
      }),
    ).rejects.toThrow();
  });

  it("answers a reset request for an unknown email without error or email", async () => {
    await expect(
      auth.api.requestPasswordReset({ body: { email: "nobody@example.com" } }),
    ).resolves.toBeTruthy();
    await expect(
      waitForEmail(env.email.outboxDir, "nobody@example.com", /reset/i, 500),
    ).rejects.toThrow(/No email/);
  });
});

describe("HTTP surface", () => {
  it("serves only the verification link; sign-in and sign-up over HTTP are closed", async () => {
    await auth.api.signUpEmail({ body: customer });
    const base = env.siteUrl.origin;
    const post = (path: string, body: unknown) =>
      auth.handler(
        new Request(`${base}/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: base },
          body: JSON.stringify(body),
        }),
      );

    expect(
      (
        await post("/sign-in/email", {
          email: customer.email,
          password: PASSWORD,
        })
      ).status,
    ).toBe(404);
    expect(
      (await post("/sign-up/email", { ...customer, email: "x@example.com" }))
        .status,
    ).toBe(404);
    expect(
      (await post("/forget-password", { email: customer.email })).status,
    ).toBe(404);
    expect(
      (await auth.handler(new Request(`${base}/api/auth/ok`))).status,
    ).toBe(200);
    expect(await testDb.session.count()).toBe(0);
  });
});

describe("security review regressions", () => {
  beforeEach(async () => {
    await auth.api.signUpEmail({ body: customer });
  });

  it("rejects an expired session on the very next request, without any sweep", async () => {
    const { requestHeaders } = await signIn();
    expect(
      await auth.api.getSession({ headers: requestHeaders }),
    ).not.toBeNull();

    await testDb.session.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await auth.api.getSession({ headers: requestHeaders })).toBeNull();
    expect(
      await auth.api.listSessions({ headers: requestHeaders }).catch(() => []),
    ).toEqual([]);
  });

  it("never lets a customer revoke another customer's session", async () => {
    const victim = await signIn();
    const victimToken = (
      await auth.api.getSession({ headers: victim.requestHeaders })
    )?.session.token;
    if (!victimToken) throw new Error("expected victim session");

    await auth.api.signUpEmail({
      body: {
        name: "Ravi",
        email: "ravi@example.com",
        password: "lotus medallion dupatta",
      },
    });
    const attacker = await signIn(
      "ravi@example.com",
      "lotus medallion dupatta",
    );
    await auth.api.revokeSession({
      headers: attacker.requestHeaders,
      body: { token: victimToken },
    });

    expect(
      await auth.api.getSession({ headers: victim.requestHeaders }),
    ).not.toBeNull();
    expect(await testDb.session.count()).toBe(2);
  });

  it("refuses role and phone changes through Better Auth's own update endpoint", async () => {
    const { requestHeaders } = await signIn();
    await expect(
      auth.api.updateUser({
        headers: requestHeaders,
        body: { role: "ADMIN" } as { name?: string },
      }),
    ).rejects.toThrow(/role is not allowed/);
    await expect(
      auth.api.updateUser({
        headers: requestHeaders,
        body: { phone: "+911234567890" } as { name?: string },
      }),
    ).rejects.toThrow(/phone is not allowed/);
    const user = await testDb.user.findUniqueOrThrow({
      where: { email: customer.email },
    });
    expect(user).toMatchObject({ role: "CUSTOMER", phone: null });
  });

  it("answers reset requests for known and unknown emails with the same shape", async () => {
    const known = await auth.api.requestPasswordReset({
      body: { email: customer.email },
    });
    const unknown = await auth.api.requestPasswordReset({
      body: { email: "nobody@example.com" },
    });
    expect(Object.keys(known).sort()).toEqual(Object.keys(unknown).sort());
    expect(known.status).toBe(unknown.status);
  });
});
