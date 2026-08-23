import { describe, expect, it } from "vitest";
import { formatImageReadOutput } from "../src/read-image.js";

describe("formatImageReadOutput", () => {
  it("includes coordinate scale advice when originalDimensions present", () => {
    const text = formatImageReadOutput("shots/ui.png", {
      attachmentId: "sha256:abc",
      mediaType: "image/png",
      bytes: 1200,
      width: 512,
      height: 256,
      originalDimensions: { width: 1024, height: 512 },
    });
    expect(text).toContain("multiply coordinates by 2.00");
    expect(text).toContain("downscaled from 1024x512 px");
  });
});
