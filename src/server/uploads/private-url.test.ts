import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { deliverySignature, signedDeliveryUrl } from "./private-url";

const base = {
  cloudName: "demo",
  apiSecret: "abcd",
  publicId: "madhuyamini/returns/u1/x9",
  format: "jpg",
  version: 1700000000,
  transformation: "c_limit,w_640",
  type: "authenticated" as const,
};

function expected(toSign: string): string {
  const digest = createHash("sha1")
    .update(`${toSign}${base.apiSecret}`)
    .digest("base64")
    .replace(/\//g, "_")
    .replace(/\+/g, "-");
  return `s--${digest.slice(0, 8)}--`;
}

describe("signed delivery URLs", () => {
  it("signs the transformation and the public id with format, never the version", () => {
    expect(deliverySignature(base)).toBe(
      expected("c_limit,w_640/madhuyamini/returns/u1/x9.jpg"),
    );
    expect(deliverySignature({ ...base, transformation: null })).toBe(
      expected("madhuyamini/returns/u1/x9.jpg"),
    );
  });

  it("places the signature before the transformation and the version before the public id", () => {
    expect(signedDeliveryUrl(base)).toBe(
      `https://res.cloudinary.com/demo/image/authenticated/${expected("c_limit,w_640/madhuyamini/returns/u1/x9.jpg")}/c_limit,w_640/v1700000000/madhuyamini/returns/u1/x9.jpg`,
    );
    expect(
      signedDeliveryUrl({ ...base, transformation: null, version: null }),
    ).toBe(
      `https://res.cloudinary.com/demo/image/authenticated/${expected("madhuyamini/returns/u1/x9.jpg")}/madhuyamini/returns/u1/x9.jpg`,
    );
  });

  it("uses URL-safe characters only", () => {
    for (let i = 0; i < 50; i += 1) {
      const signature = deliverySignature({
        ...base,
        publicId: `madhuyamini/returns/u1/x${i}`,
      });
      expect(signature).toMatch(/^s--[A-Za-z0-9_-]{8}--$/);
    }
  });
});
