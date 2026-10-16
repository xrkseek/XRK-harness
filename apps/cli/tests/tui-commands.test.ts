import { describe, expect, it } from "vitest";
import {
  formatModelCatalog,
  formatSessionList,
  parseTuiSlash,
  resolveModelArg,
} from "../src/tui-commands.js";

describe("tui-commands (dsh-tui-style)", () => {
  it("parses slash name and arg", () => {
    expect(parseTuiSlash("/model")).toEqual({ name: "model", arg: "" });
    expect(parseTuiSlash("/model deepseek/v3 high")).toEqual({
      name: "model",
      arg: "deepseek/v3 high",
    });
    expect(parseTuiSlash("plain")).toBeNull();
  });

  it("lists and resolves catalog models", () => {
    const catalog = {
      current: { provider: "deepseek", model: "v3" },
      groups: [
        {
          id: "deepseek",
          name: "DeepSeek",
          models: [
            {
              id: "v3",
              reasoning: {
                efforts: [{ id: "off" }, { id: "high" }],
                defaultEffort: "off",
              },
            },
            { id: "r1" },
          ],
        },
      ],
    };
    expect(formatModelCatalog(catalog)).toContain("deepseek/v3");
    expect(resolveModelArg("", catalog)).toEqual({ kind: "list" });
    expect(resolveModelArg("r1", catalog)).toEqual({
      kind: "select",
      provider: "deepseek",
      model: "r1",
    });
    expect(resolveModelArg("deepseek/v3 high", catalog)).toEqual({
      kind: "select",
      provider: "deepseek",
      model: "v3",
      reasoningEffort: "high",
    });
    expect(resolveModelArg("missing", catalog).kind).toBe("error");
  });

  it("formats resume list with current marker", () => {
    const text = formatSessionList(
      [
        { sessionId: "a", title: "One", updatedAt: 2, blank: false },
        { sessionId: "b", title: "Two", updatedAt: 1, blank: false },
        { sessionId: "c", blank: true, updatedAt: 9 },
      ],
      "a",
    );
    expect(text).toContain("* a");
    expect(text).toContain("  b");
    expect(text).not.toMatch(/\bc\b/);
  });
});
