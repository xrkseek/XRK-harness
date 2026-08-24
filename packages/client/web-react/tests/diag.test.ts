import { afterEach, describe, expect, it, vi } from "vitest";
import { makeDiag, shortError } from "../src/diag.ts";

describe("diag", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shortError prefers Error.message", () => {
    expect(shortError(new Error("boom"))).toBe("boom");
    expect(shortError("plain")).toBe("plain");
  });

  it("makeDiag emits scoped console lines", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    makeDiag("slot").child("settings").error("entry crashed");
    expect(error).toHaveBeenCalled();
    const line = String(error.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("slot.settings");
    expect(line).toContain("entry crashed");
  });
});
