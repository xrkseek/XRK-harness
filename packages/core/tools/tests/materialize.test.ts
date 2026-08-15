import { describe, expect, it } from "vitest";
import {
  createToolRegistry,
  materializeTools,
  type ToolDefinition,
} from "../src/index.js";

const make = (name: string, tag: string): ToolDefinition => ({
  name,
  description: tag,
  parameters: { type: "object", properties: {} },
  async execute() {
    return { content: tag };
  },
});

describe("materializeTools", () => {
  it("snapshots catalog and settles captured tool", async () => {
    const reg = createToolRegistry();
    reg.register(make("echo", "v1"));
    const table = materializeTools(reg);
    expect(table.list().map((t) => t.description)).toEqual(["v1"]);
    const out = await table.settle({
      call: { id: "1", name: "echo", arguments: {} },
    });
    expect(out.result.content).toBe("v1");
    expect(out.result.isError).toBeUndefined();
  });

  it("returns stale when live instance replaced", async () => {
    const reg = createToolRegistry();
    reg.register(make("echo", "v1"));
    const table = materializeTools(reg);
    reg.replace(make("echo", "v2"));
    const out = await table.settle({
      call: { id: "1", name: "echo", arguments: {} },
    });
    expect(out.result.isError).toBe(true);
    expect(out.result.content).toContain("Stale tool call");
    expect(out.skippedBody).toBe(true);
  });

  it("returns unknown when not in snapshot", async () => {
    const reg = createToolRegistry();
    reg.register(make("echo", "v1"));
    const table = materializeTools(reg, { omitNames: ["echo"] });
    expect(table.list()).toHaveLength(0);
    const out = await table.settle({
      call: { id: "1", name: "echo", arguments: {} },
    });
    expect(out.result.content).toContain("Unknown tool");
  });

  it("omitNames is catalog filter only (execution still via resolve)", () => {
    const reg = createToolRegistry();
    reg.register(make("a", "1"));
    reg.register(make("b", "2"));
    const table = materializeTools(reg, { omitNames: ["b"] });
    expect(table.list().map((t) => t.name)).toEqual(["a"]);
    expect(table.resolve("b").ok).toBe(false);
  });
});
