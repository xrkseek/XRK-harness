import { describe, expect, it } from "vitest";
import { normalizeOpenPath } from "../src/host-open-path.js";

describe("normalizeOpenPath", () => {
  it("strips trailing slash-dot from client joins", () => {
    expect(normalizeOpenPath("C:\\proj\\.")).toBe("C:\\proj");
    expect(normalizeOpenPath("/proj/.")).toBe("/proj");
    expect(normalizeOpenPath("/proj/")).toBe("/proj");
  });
});
