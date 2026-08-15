import { describe, expect, it } from "vitest";
import { createToolRegistry, runTool } from "../src/index.js";

describe("core-tools", () => {
  it("registers and runs a fake tool", async () => {
    const reg = createToolRegistry();
    reg.register({
      name: "ping",
      description: "ping",
      parameters: { type: "object" },
      async execute() {
        return { content: "pong" };
      },
    });
    const result = await runTool(reg, {
      id: "1",
      name: "ping",
      arguments: {},
    });
    expect(result).toEqual({
      toolCallId: "1",
      name: "ping",
      content: "pong",
    });
  });

  it("returns error for unknown tool", async () => {
    const reg = createToolRegistry();
    const result = await runTool(reg, {
      id: "1",
      name: "nope",
      arguments: {},
    });
    expect(result.isError).toBe(true);
  });
});
