import "server-only";

import { headers } from "next/headers";

import { auth } from "@/server/auth/auth";
import type { CurrentUser } from "@/server/auth/current-user";
import { sendEmail } from "@/server/email";
import { passwordChangedMessage } from "@/server/email/templates";
import { NotFoundError } from "@/server/errors";

import * as data from "./data";
import type { AddressInput } from "./schemas";

const MAX_ADDRESSES = 10;

export class AddressLimitError extends Error {
  constructor() {
    super(`You can keep up to ${MAX_ADDRESSES} addresses.`);
    this.name = "AddressLimitError";
  }
}

export async function listAddresses(user: CurrentUser) {
  return data.findAddresses(user.id);
}

export async function getAddress(user: CurrentUser, id: string) {
  const address = await data.findAddress(user.id, id);
  if (!address) throw new NotFoundError("Address");
  return address;
}

export async function addAddress(user: CurrentUser, input: AddressInput) {
  const count = await data.countAddresses(user.id);
  if (count >= MAX_ADDRESSES) throw new AddressLimitError();
  // The first address is always the default.
  return data.createAddress(user.id, {
    ...input,
    isDefault: input.isDefault || count === 0,
  });
}

export async function editAddress(
  user: CurrentUser,
  id: string,
  input: AddressInput,
) {
  const updated = await data.updateAddress(user.id, id, input);
  if (!updated) throw new NotFoundError("Address");
}

export async function removeAddress(user: CurrentUser, id: string) {
  const removed = await data.deleteAddress(user.id, id);
  if (!removed) throw new NotFoundError("Address");
}

export async function makeDefaultAddress(user: CurrentUser, id: string) {
  const changed = await data.setDefaultAddress(user.id, id);
  if (!changed) throw new NotFoundError("Address");
}

export async function saveProfile(
  user: CurrentUser,
  input: { name: string; phone: string | null },
) {
  await data.updateProfile(user.id, input);
}

export interface SessionSummary {
  readonly token: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly userAgent: string | null;
  readonly isCurrent: boolean;
}

export async function listSessions(
  user: CurrentUser,
): Promise<SessionSummary[]> {
  const sessions = await auth.api.listSessions({ headers: await headers() });
  return sessions
    .map((session) => ({
      token: session.token,
      createdAt: new Date(session.createdAt),
      expiresAt: new Date(session.expiresAt),
      userAgent: session.userAgent ?? null,
      isCurrent: session.token === user.session.token,
    }))
    .sort(
      (a, b) =>
        Number(b.isCurrent) - Number(a.isCurrent) ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
}

/** Changes the password, rotates this session, signs out every other device, and emails the customer. */
export async function changePassword(
  user: CurrentUser,
  currentPassword: string,
  newPassword: string,
) {
  await auth.api.changePassword({
    headers: await headers(),
    body: { currentPassword, newPassword, revokeOtherSessions: true },
  });
  await sendEmail(passwordChangedMessage({ to: user.email, name: user.name }));
}

export async function revokeSession(token: string) {
  await auth.api.revokeSession({ headers: await headers(), body: { token } });
}

export async function revokeOtherSessions() {
  await auth.api.revokeOtherSessions({ headers: await headers() });
}

export async function revokeAllSessions() {
  await auth.api.revokeSessions({ headers: await headers() });
}
