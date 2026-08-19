import { describe, expect, it } from "vitest";
import { normalizeApiKey } from "../src/llm-api-key.js";

describe("normalizeApiKey", () => {
  it("accepts printable ASCII keys", () => {
    expect(normalizeApiKey("  sk-live-key_1  ")).toEqual({
      ok: true,
      value: "sk-live-key_1",
    });
  });

  it("rejects blank and illegal characters", () => {
    expect(normalizeApiKey("   ").ok).toBe(false);
    expect(normalizeApiKey("bad key").ok).toBe(false);
    expect(normalizeApiKey("café").ok).toBe(false);
  });
});
