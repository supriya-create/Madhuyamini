import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  expectedResponseSignature,
  isWithinUploadFolder,
  serializeParams,
  signParams,
} from "./signature";

describe("Cloudinary signing", () => {
  it("signs sorted key=value pairs followed by the secret, skipping empty values", () => {
    const params = {
      timestamp: 1_700_000_000,
      folder: "a/b",
      public_id: "a/b/c",
      eager: "",
    };
    expect(serializeParams(params)).toBe(
      "folder=a/b&public_id=a/b/c&timestamp=1700000000",
    );
    expect(signParams(params, "secret")).toBe(
      createHash("sha1")
        .update("folder=a/b&public_id=a/b/c&timestamp=1700000000secret")
        .digest("hex"),
    );
  });

  it("computes the upload response signature the way Cloudinary does", () => {
    expect(expectedResponseSignature("a/b/c", 1234, "secret")).toBe(
      createHash("sha1")
        .update("public_id=a/b/c&version=1234secret")
        .digest("hex"),
    );
  });

  it("accepts only ids inside our folder with plain path segments", () => {
    const folder = "madhuyamini/products";
    expect(isWithinUploadFolder("madhuyamini/products/p1/img_1", folder)).toBe(
      true,
    );
    expect(isWithinUploadFolder("madhuyamini/products/x", folder)).toBe(true);
    expect(isWithinUploadFolder("madhuyamini/products", folder)).toBe(false);
    expect(isWithinUploadFolder("madhuyamini/productsx/y", folder)).toBe(false);
    expect(isWithinUploadFolder("other/products/y", folder)).toBe(false);
    expect(isWithinUploadFolder("madhuyamini/products/../secret", folder)).toBe(
      false,
    );
    expect(isWithinUploadFolder("madhuyamini/products/a b", folder)).toBe(
      false,
    );
    expect(isWithinUploadFolder("madhuyamini/products/", folder)).toBe(false);
  });
});
