import { describe, expect, it } from "vitest";
import {
  projectToolDeclarations,
  protocolSupportsToolUpdate,
} from "../src/tool-update.js";

const search = {
  name: "search",
  description: "s",
  parameters: {},
};
const fetchTool = {
  name: "fetch",
  description: "f",
  parameters: {},
};

describe("projectToolDeclarations", () => {
  it("strips deferLoading when the route has no toolUpdate", () => {
    const projected = projectToolDeclarations({
      tools: [{ ...search, deferLoading: true }],
    });
    expect(projected).toEqual({
      tools: [search],
      activations: [],
      rebuilt: false,
    });
  });

  it("first wire is fully immediate (no defer)", () => {
    expect(
      projectToolDeclarations({
        tools: [fetchTool, search],
        toolUpdate: "addition-only",
      }),
    ).toEqual({
      tools: [fetchTool, search],
      activations: [],
      rebuilt: false,
    });
  });

  it("addition-only defers newcomers and lists activations", () => {
    const projected = projectToolDeclarations({
      tools: [fetchTool, search],
      priorNames: ["fetch"],
      toolUpdate: "addition-only",
    });
    expect(projected.tools).toEqual([
      fetchTool,
      { ...search, deferLoading: true },
    ]);
    expect(projected.activations).toEqual(["search"]);
    expect(projected.rebuilt).toBe(false);
  });

  it("addition-only rebuilds on removal", () => {
    const projected = projectToolDeclarations({
      tools: [search],
      priorNames: ["fetch", "search"],
      toolUpdate: "addition-only",
    });
    expect(projected).toEqual({
      tools: [search],
      activations: [],
      rebuilt: true,
    });
  });
});

describe("protocolSupportsToolUpdate", () => {
  it("only anthropic-messages", () => {
    expect(protocolSupportsToolUpdate("anthropic-messages")).toBe(true);
    expect(protocolSupportsToolUpdate("openai-chat")).toBe(false);
    expect(protocolSupportsToolUpdate(undefined)).toBe(false);
  });
});
