import { describe, expect, it } from "vitest";
import {
  handleModlensRpc,
  parseModlensPastePreview,
} from "../src/dsh-compat/modlens.js";

describe("modlens paste preview", () => {
  it("extracts urls engines and model tokens heuristically", () => {
    const text =
      "Use claude-3.5 and codex\nhttps://example.com/a\nhttps://example.com/a";
    const items = parseModlensPastePreview(text);
    expect(items.some((r) => r.kind === "url" && r.value === "https://example.com/a")).toBe(
      true,
    );
    expect(items.filter((r) => r.kind === "url").length).toBe(1);
    expect(items.some((r) => r.kind === "engine" && r.value === "codex")).toBe(true);
    expect(items.some((r) => r.kind === "model" && r.value === "claude-3.5")).toBe(true);
    expect(items.some((r) => r.kind === "lines")).toBe(true);
  });

  it("returns tagged incomplete envelope from RPC paste", () => {
    const body = handleModlensRpc(
      "paste",
      { text: "gpt-4o on https://x.test" },
      {},
    );
    expect(body.incomplete).toEqual(["modlens-host"]);
    expect(body.preview).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
    expect((body.items as Array<{ kind: string }>).length).toBeGreaterThan(0);
  });
});
