import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

import type { AddressInput } from "./schemas";

/**
 * Account data access. Every query is scoped by the verified user id, so a
 * customer can never read or change another customer's rows (IDOR).
 */

const addressSelect = {
  id: true,
  label: true,
  recipientName: true,
  phone: true,
  line1: true,
  line2: true,
  landmark: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  isDefault: true,
} satisfies Prisma.AddressSelect;

export type AddressRow = Prisma.AddressGetPayload<{
  select: typeof addressSelect;
}>;

export function findAddresses(userId: string) {
  return db.address.findMany({
    where: { userId },
    select: addressSelect,
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

export function findAddress(userId: string, id: string) {
  return db.address.findFirst({ where: { id, userId }, select: addressSelect });
}

export async function countAddresses(userId: string) {
  return db.address.count({ where: { userId } });
}

/** Creates an address; making it the default clears the previous default atomically. */
export function createAddress(userId: string, input: AddressInput) {
  return db.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.address.create({
      data: { ...input, userId },
      select: addressSelect,
    });
  });
}

export function updateAddress(userId: string, id: string, input: AddressInput) {
  return db.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.address.updateMany({
        where: { userId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }
    const result = await tx.address.updateMany({
      where: { id, userId },
      data: input,
    });
    return result.count === 1;
  });
}

export async function deleteAddress(userId: string, id: string) {
  const result = await db.address.deleteMany({ where: { id, userId } });
  return result.count === 1;
}

export function setDefaultAddress(userId: string, id: string) {
  return db.$transaction(async (tx) => {
    const owned = await tx.address.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!owned) return false;
    await tx.address.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
    await tx.address.update({ where: { id }, data: { isDefault: true } });
    return true;
  });
}

export async function updateProfile(
  userId: string,
  data: { name: string; phone: string | null },
) {
  await db.user.update({ where: { id: userId }, data, select: { id: true } });
}
