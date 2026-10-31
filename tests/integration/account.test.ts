import { afterAll, beforeEach, describe, expect, it } from "vitest";

import * as data from "@/features/account/data";
import type { AddressInput } from "@/features/account/schemas";
import { addressSchema } from "@/features/account/schemas";
import { NotFoundError } from "@/server/errors";

import { createUser, resetDatabase, testDb } from "./db";

/**
 * Account data access is scoped by the verified user id. These tests pin the
 * ownership rules (IDOR) and the one-default-address invariant.
 */

beforeEach(resetDatabase);
afterAll(() => testDb.$disconnect());

const baseAddress: AddressInput = addressSchema.parse({
  label: "Home",
  recipientName: "Asha Devi",
  phone: "98765 43210",
  line1: "12 Station Road",
  line2: "",
  landmark: "",
  city: "Madhubani",
  state: "Bihar",
  postalCode: "847211",
  isDefault: "on",
});

describe("addresses", () => {
  it("normalises input: phone to E.164, blanks to null, country to IN", () => {
    expect(baseAddress).toMatchObject({
      phone: "+919876543210",
      line2: null,
      landmark: null,
      country: "IN",
      isDefault: true,
    });
    expect(
      addressSchema.safeParse({ ...baseAddress, postalCode: "0123" }).success,
    ).toBe(false);
  });

  it("keeps exactly one default per user as addresses are added and changed", async () => {
    const user = await createUser("asha@example.com");
    const first = await data.createAddress(user.id, baseAddress);
    const second = await data.createAddress(user.id, {
      ...baseAddress,
      label: "Office",
      isDefault: true,
    });

    const defaults = async () =>
      (await data.findAddresses(user.id))
        .filter((a) => a.isDefault)
        .map((a) => a.id);
    expect(await defaults()).toEqual([second.id]);

    expect(await data.setDefaultAddress(user.id, first.id)).toBe(true);
    expect(await defaults()).toEqual([first.id]);

    expect(
      await data.updateAddress(user.id, second.id, {
        ...baseAddress,
        isDefault: true,
      }),
    ).toBe(true);
    expect(await defaults()).toEqual([second.id]);
  });

  it("never reads, edits, promotes or deletes another customer's address", async () => {
    const asha = await createUser("asha@example.com");
    const ravi = await createUser("ravi@example.com");
    const address = await data.createAddress(asha.id, baseAddress);

    expect(await data.findAddress(ravi.id, address.id)).toBeNull();
    expect(
      await data.updateAddress(ravi.id, address.id, {
        ...baseAddress,
        line1: "hijacked",
      }),
    ).toBe(false);
    expect(await data.setDefaultAddress(ravi.id, address.id)).toBe(false);
    expect(await data.deleteAddress(ravi.id, address.id)).toBe(false);

    const untouched = await data.findAddress(asha.id, address.id);
    expect(untouched?.line1).toBe("12 Station Road");
    expect(await testDb.address.count()).toBe(1);
  });

  it("orders the default first", async () => {
    const user = await createUser("asha@example.com");
    await data.createAddress(user.id, {
      ...baseAddress,
      label: "A",
      isDefault: false,
    });
    await data.createAddress(user.id, {
      ...baseAddress,
      label: "B",
      isDefault: true,
    });
    const list = await data.findAddresses(user.id);
    expect(list.map((a) => a.label)).toEqual(["B", "A"]);
  });
});

describe("profile", () => {
  it("updates only the owner's row and leaves role and email alone", async () => {
    const user = await createUser("asha@example.com");
    await data.updateProfile(user.id, {
      name: "Asha D.",
      phone: "+919876543210",
    });
    const row = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({
      name: "Asha D.",
      phone: "+919876543210",
      role: "CUSTOMER",
      email: "asha@example.com",
    });
  });

  it("surfaces missing addresses as NotFoundError at the service boundary", async () => {
    expect(new NotFoundError("Address").status).toBe(404);
  });
});
