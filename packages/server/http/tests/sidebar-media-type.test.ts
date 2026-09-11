import { describe, expect, it } from "vitest";
import { mediaTypeForPath } from "../src/sidebar/sidebar-media-type.js";

describe("sidebar mediaTypeForPath", () => {
  it("maps preview-relevant extensions", () => {
    expect(mediaTypeForPath("a.md")).toMatch(/^text\/markdown/);
    expect(mediaTypeForPath("b.PDF")).toBe("application/pdf");
    expect(mediaTypeForPath("c.png")).toBe("image/png");
    expect(mediaTypeForPath("d.html")).toMatch(/^text\/html/);
    expect(mediaTypeForPath("e.ts")).toBe("application/octet-stream");
  });
});
