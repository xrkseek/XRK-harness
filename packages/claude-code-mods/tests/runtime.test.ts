// The product runtime has no Cordis container in the request path, so the bridge
// has to assemble over a plain service bag. These tests prove that path works by
// itself: no `ctx.plugin`, no Context, just the host's pipeline and services.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createToolPipeline, type ToolDefinition } from "@xrkseek/core-tools";

import { createModsRuntime, type ModsLogger } from "../src/index.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const dirOf = (name: string) => path.join(FIXTURES, name);

const bash: ToolDefinition<{ command: string }> = {
  name: "bash",
  description: "Run a shell command",
  parameters: { type: "object", properties: { command: { type: "string" } } },
  execute: async (args) => ({ content: `ran: ${args.command}` }),
};

const call = (command: string) => ({
  id: "call-1",
  name: "bash",
  arguments: { command },
});

function quietLogger(): ModsLogger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    debug: (line) => lines.push(`debug ${line}`),
    info: (line) => lines.push(`info ${line}`),
    warn: (line) => lines.push(`warn ${line}`),
    error: (line) => lines.push(`error ${line}`),
  };
}

describe("createModsRuntime (no Cordis)", () => {
  it("loads plugin directories and intercepts tool calls", async () => {
    const pipeline = createToolPipeline();
    const runtime = await createModsRuntime({
      services: {},
      pipeline,
      dirs: [dirOf("guard-plugin")],
      logger: quietLogger(),
    });
    try {
      expect(runtime.mods.map((mod) => mod.name)).toEqual(["guard"]);
      const refused = await pipeline.run(bash, call("rm -rf /tmp/x"), undefined, {});
      expect(JSON.stringify(refused)).toContain("guard refused this command");

      const allowed = await pipeline.run(bash, call("ls"), undefined, {});
      expect(JSON.stringify(allowed)).toContain("ran: ls");
    } finally {
      await runtime.dispose();
    }
  });

  it("dispatches host-owned events through the same chain", async () => {
    const runtime = await createModsRuntime({
      services: {},
      dirs: [dirOf("tool-rewrite")],
      logger: quietLogger(),
    });
    try {
      // No pipeline here: `dispatch` is the whole surface this host uses.
      const answer = await runtime.dispatch<string, string>(
        "prompt.submit",
        "hi",
        (text) => text,
      );
      expect(answer).toBe("hi");
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps going when one plugin directory is broken, and names it", async () => {
    const logger = quietLogger();
    const runtime = await createModsRuntime({
      services: {},
      dirs: [dirOf("no-register"), dirOf("guard-plugin")],
      logger,
    });
    try {
      expect(runtime.mods.map((mod) => mod.name)).toEqual(["guard"]);
      expect(logger.lines.some((line) => line.includes("did not load"))).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });

  it("restores the pipeline on dispose", async () => {
    const pipeline = createToolPipeline();
    const runtime = await createModsRuntime({
      services: {},
      pipeline,
      dirs: [dirOf("guard-plugin")],
      logger: quietLogger(),
    });
    await runtime.dispose();
    const outcome = await pipeline.run(bash, call("rm -rf /tmp/x"), undefined, {});
    expect(JSON.stringify(outcome)).toContain("ran: rm -rf /tmp/x");
  });

  // A `{ result }` from the pre pass is how a mod answers for a tool whose body
  // is a placeholder (every `$.tool.register` definition). Running the body
  // anyway would fire a rejection the post pass then had to paper over — and
  // would raise the same call's hooks twice.
  it("short-circuits the body when a hook answers before dispatch", async () => {
    const logger = quietLogger();
    const pipeline = createToolPipeline();
    let ran = false;
    const watched: ToolDefinition<{ command: string }> = {
      ...bash,
      execute: async () => {
        ran = true;
        return { content: "body ran" };
      },
    };
    const runtime = await createModsRuntime({
      services: {},
      pipeline,
      dirs: [dirOf("tool-rewrite")],
      logger,
    });
    try {
      const outcome = await pipeline.run(watched, call("ls"), undefined, {});
      expect(ran).toBe(false);
      expect(JSON.stringify(outcome)).toContain("rewritten by mod");
      // One call, one raise: the post pass stands down once the pre pass answered.
      expect(logger.lines.filter((line) => line.includes("rewrote")).length).toBe(1);
    } finally {
      await runtime.dispose();
    }
  });
});
