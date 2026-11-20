import { describe, expect, it } from "vitest";
import { mcpAllowFromLayers } from "../src/mcp-allow.js";

describe("mcpAllowFromLayers", () => {
  it("defaults to allow when neither layer sets the bit", () => {
    expect(mcpAllowFromLayers({ base: {}, user: {} })).toBe(true);
    expect(mcpAllowFromLayers({ base: { servers: [] }, user: {} })).toBe(true);
  });

  it("honors an explicit user deny", () => {
    expect(
      mcpAllowFromLayers({
        base: { allowConnect: true },
        user: { allowConnect: false },
      }),
    ).toBe(false);
  });

  it("honors product base allow when user is silent", () => {
    expect(
      mcpAllowFromLayers({
        base: { servers: [], allowConnect: true },
        user: {},
      }),
    ).toBe(true);
  });

  it("honors an explicit base deny without user override", () => {
    expect(
      mcpAllowFromLayers({
        base: { allowConnect: false },
        user: {},
      }),
    ).toBe(false);
  });
});
