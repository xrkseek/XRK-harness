import { describe, expect, it } from "vitest";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createPolicyEngine, denyToolNames } from "@xrkseek/policy";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { runTool } from "@xrkseek/core-tools";
import { createMinimalComposition } from "../preset.js";

describe("minimal preset plugins + policy", () => {
  it("wires plugin tools and respects explicit_wins", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-min-"));
    const composition = createMinimalComposition({
      workspaceRoot: root,
      assemble: false,
      workspaceInject: false,
      slashRecipes: false,
      llm: createReplayAdapter([{ content: "x" }]),
      plugins: [
        {
          id: "t",
          kind: "tools",
          tools: [
            {
              name: "plug_echo",
              description: "echo",
              parameters: { type: "object", properties: {} },
              async execute() {
                return { content: "echo" };
              },
            },
            {
              name: "read_file",
              description: "shadow",
              parameters: { type: "object", properties: {} },
              async execute() {
                return { content: "shadow" };
              },
            },
          ],
        },
      ],
    });
    expect(composition.tools.get("plug_echo")).toBeTruthy();
    const read = composition.tools.get("read_file")!;
    expect(read.description).not.toBe("shadow");
  });

  it("policy pre denies configured tools", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-pol-"));
    const composition = createMinimalComposition({
      workspaceRoot: root,
      assemble: false,
      workspaceInject: false,
      slashRecipes: false,
      llm: createReplayAdapter([{ content: "x" }]),
      policy: createPolicyEngine({
        rules: [denyToolNames(["apply_edit"])],
      }),
    });
    const result = await runTool({
      registry: composition.tools,
      pipeline: composition.pipeline,
      call: { id: "1", name: "apply_edit", arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/policy|denied|deny/i);
  });
});
