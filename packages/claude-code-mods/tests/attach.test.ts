// The attach point is where a plugin directory stops being data and starts
// intercepting real tool calls. These tests drive the product's own
// `ToolPipeline` with a real plugin directory, so what is asserted is the
// contract the model would actually experience: a refusal arrives as a tool
// error, and a replacement changes what the model reads.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { Context, Service } from "@xrkseek/cordis";
import { createToolPipeline, type ToolDefinition } from "@xrkseek/core-tools";

import { attachClaudeCodeMods } from "../src/index.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const dirOf = (name: string) => path.join(FIXTURES, name);

/** The seam the bridge injects; the real one is composed by the host. */
class WorkingDirectoryFixture extends Service {
  constructor(ctx: Context) {
    super(ctx, "workingDirectory");
  }

  ensure = async (): Promise<string> => process.cwd();
}

const bash: ToolDefinition<{ command: string }> = {
  name: "bash",
  description: "Run a shell command",
  parameters: { type: "object", properties: { command: { type: "string" } } },
  execute: async (args) => ({ content: `ran: ${args.command}` }),
};

async function attach(dirs: readonly string[]) {
  const ctx = new Context();
  await ctx.plugin(WorkingDirectoryFixture);
  const pipeline = createToolPipeline();
  const attached = await attachClaudeCodeMods({ ctx, pipeline, dirs });
  return { ctx, pipeline, attached };
}

const call = (command: string) => ({
  id: "call-1",
  name: "bash",
  arguments: { command },
});

describe("attachClaudeCodeMods: tool.call interception", () => {
  it("turns a mod refusal into the tool error the model reads", async () => {
    const { pipeline, attached } = await attach([dirOf("guard-plugin")]);
    try {
      const outcome = await pipeline.run(
        bash,
        call("git push --force origin main"),
        undefined,
        {},
      );
      const text = JSON.stringify(outcome);
      expect(text).toContain("guard refused this command");
      expect(text).toContain("git push --force origin main");
      // The tool body must not have run: a refusal is a refusal, not a warning.
      expect(text).not.toContain("ran: git push --force");
    } finally {
      attached.dispose();
    }
  });

  it("lets an unremarkable command through to the tool body", async () => {
    const { pipeline, attached } = await attach([dirOf("guard-plugin")]);
    try {
      const outcome = await pipeline.run(bash, call("ls -la"), undefined, {});
      expect(JSON.stringify(outcome)).toContain("ran: ls -la");
    } finally {
      attached.dispose();
    }
  });

  it("replaces the result after the call runs", async () => {
    const { pipeline, attached } = await attach([dirOf("tool-rewrite")]);
    try {
      const outcome = await pipeline.run(bash, call("ls -la"), undefined, {});
      const text = JSON.stringify(outcome);
      expect(text).toContain("rewritten by mod");
      expect(text).not.toContain("ran: ls -la");
    } finally {
      attached.dispose();
    }
  });

  it("leaves the pipeline untouched after dispose", async () => {
    const { pipeline, attached } = await attach([dirOf("guard-plugin")]);
    expect(attached.mods.map((mod) => mod.name)).toEqual(["guard"]);
    attached.dispose();
    const outcome = await pipeline.run(bash, call("git push --force"), undefined, {});
    expect(JSON.stringify(outcome)).toContain("ran: git push --force");
  });

  it("exposes the loaded mods for inventory", async () => {
    const { attached } = await attach([dirOf("guard-plugin"), dirOf("tool-rewrite")]);
    try {
      expect(attached.mods.map((mod) => mod.name)).toEqual(["guard", "tool-rewrite"]);
    } finally {
      attached.dispose();
    }
  });
});
