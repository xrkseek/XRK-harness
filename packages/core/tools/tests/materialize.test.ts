import { describe, expect, it } from "vitest";
import {
  createToolRegistry,
  materializeTools,
  applyToolDynamicSchema,
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

  it("applies dynamicSchema to catalog without flipping settle to stale", async () => {
    let gate = false;
    const reg = createToolRegistry();
    const tool: ToolDefinition = {
      name: "gated",
      description: "static",
      parameters: { type: "object", properties: { a: { type: "string" } } },
      dynamicSchema: () =>
        gate
          ? {
              description: "live-open",
              parameters: {
                type: "object",
                properties: {
                  a: { type: "string" },
                  b: { type: "number" },
                },
              },
            }
          : {
              description: "live-closed",
              parameters: { type: "object", properties: { a: { type: "string" } } },
            },
      async execute() {
        return { content: "ok" };
      },
    };
    reg.register(tool);

    const closed = materializeTools(reg);
    expect(closed.list()[0]!.description).toBe("live-closed");
    expect(
      (closed.list()[0]!.parameters.properties as Record<string, unknown>).b,
    ).toBeUndefined();

    gate = true;
    const open = materializeTools(reg);
    expect(open.list()[0]!.description).toBe("live-open");
    expect(
      (open.list()[0]!.parameters.properties as Record<string, unknown>).b,
    ).toBeTruthy();

    // Catalog copy ≠ live identity, but settle still uses live registry tool.
    const out = await open.settle({
      call: { id: "1", name: "gated", arguments: {} },
    });
    expect(out.result.content).toBe("ok");
    expect(out.result.isError).toBeUndefined();
  });

  it("dynamicSchema soft-fails to static fields", () => {
    const tool: ToolDefinition = {
      name: "boom",
      description: "keep-me",
      parameters: { type: "object", properties: {} },
      dynamicSchema: () => {
        throw new Error("caps unavailable");
      },
      async execute() {
        return { content: "x" };
      },
    };
    const reg = createToolRegistry();
    reg.register(tool);
    const table = materializeTools(reg);
    expect(table.list()[0]!.description).toBe("keep-me");
    expect(applyToolDynamicSchema(tool)).toBe(tool);
  });
});
