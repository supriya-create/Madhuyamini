import { describe, expect, it } from "vitest";

import { buildImageUrl } from "./image-loader";

const CLOUDINARY =
  "https://res.cloudinary.com/madhuyamini/image/upload/v1700000000/products/saree.jpg";

describe("buildImageUrl", () => {
  it("inserts format, quality and width transformations for Cloudinary URLs", () => {
    expect(buildImageUrl({ src: CLOUDINARY, width: 800, quality: 80 })).toBe(
      "https://res.cloudinary.com/madhuyamini/image/upload/f_auto,q_auto:80,w_800,c_limit/v1700000000/products/saree.jpg",
    );
  });

  it("uses automatic quality when none is requested", () => {
    expect(buildImageUrl({ src: CLOUDINARY, width: 400 })).toContain(
      "/f_auto,q_auto,w_400,c_limit/",
    );
  });

  it("replaces an existing transformation segment instead of stacking", () => {
    const transformed =
      "https://res.cloudinary.com/madhuyamini/image/upload/w_200,c_fill/v1/products/saree.jpg";
    expect(buildImageUrl({ src: transformed, width: 640 })).toBe(
      "https://res.cloudinary.com/madhuyamini/image/upload/f_auto,q_auto,w_640,c_limit/v1/products/saree.jpg",
    );
  });

  it("leaves non-Cloudinary and relative sources untouched", () => {
    expect(
      buildImageUrl({ src: "https://img.example/a.jpg", width: 500 }),
    ).toBe("https://img.example/a.jpg");
    expect(buildImageUrl({ src: "/local/hero.jpg", width: 500 })).toBe(
      "/local/hero.jpg",
    );
  });
});
