import { describe, expect, it } from "vitest";
import { createAgent } from "@xrkseek/core-agent";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { faceMethodFromPath } from "../src/wire/index.js";
import {
  admittingAgentResolve,
  createBareFaceRuntime,
} from "./helpers/bare-runtime.js";

function bareRuntime(store = createMemorySessionStore()) {
  return createBareFaceRuntime({
    store,
    loadSlashRecipes: async () => [
      {
        id: "echo",
        title: "Echo",
        description: "echo args",
        parameters: [{ name: "text", required: true }],
        prompt: "ECHO:{{text}}",
        instructions: "",
      },
    ],
    resolveAgent: admittingAgentResolve(store),
  });
}

describe("Typert Remote paths", () => {
  it("claims commands/execute without stealing REST", () => {
    expect(faceMethodFromPath("/api/commands/execute")).toBe("commands/execute");
    expect(faceMethodFromPath("/api/commands/list")).toBe("commands/list");
    expect(faceMethodFromPath("/api/goals/create")).toBe("goals/create");
    expect(faceMethodFromPath("/api/sessions")).toBeUndefined();
    expect(faceMethodFromPath("/api/sessions/x/admit")).toBeUndefined();
    expect(faceMethodFromPath("/api/chat")).toBeUndefined();
  });
});

describe("commands/execute + list", () => {
  it("lists recipe commands for a live session", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const listed = await dispatchFaceMethod(runtime, "commands/list", "l", {
      args: { agentId: sessionId },
    });
    expect(listed.result.ok).toBe(true);
    if (listed.result.ok) {
      expect(listed.result.value).toEqual([
        {
          name: "compact",
          description: "Compact older conversation history",
        },
        {
          name: "echo",
          description: "echo args",
          input: { hint: "text" },
        },
        {
          name: "goal",
          description: "Set or replace the session goal",
          input: { hint: "objective" },
        },
        {
          name: "permission",
          description:
            "Switch the permission preset (sandbox mode + approval policy)",
          input: { hint: "<preset>" },
        },
        {
          name: "plan",
          description: "Enter or leave plan mode",
          input: { hint: "[off|message]" },
        },
      ]);
    }
  });

  it("executes a known slash line and logs command/run + command/done", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const frames: unknown[] = [];
    const off = runtime.bus.subscribeMux((_rpc, frame) => {
      frames.push(frame);
    });

    const exec = await dispatchFaceMethod(runtime, "commands/execute", "e", {
      args: { agentId: sessionId, line: "/echo hello world" },
    });
    off();
    expect(exec.result.ok).toBe(true);
    if (!exec.result.ok) throw new Error("execute");
    const value = exec.result.value as {
      commandId: string;
      result: { kind: string; text: string };
    };
    expect(value.commandId).toMatch(/^cmd_/);
    expect(value.result).toMatchObject({ kind: "success" });
    expect(value.result.text).toContain("hello world");

    const events = runtime.store.get(sessionId).events;
    expect(events.map((e) => e.type)).toEqual([
      "permission/preset",
      "sandbox/mode",
      "approval/policy",
      "command/run",
      "command/done",
    ]);
    expect(frames).toHaveLength(2);
    expect(frames).toMatchObject([
      {
        type: "session/event",
        event: { type: "command/run", data: { name: "echo" } },
      },
      {
        type: "session/event",
        event: { type: "command/done", data: { kind: "success" } },
      },
    ]);
  });

  it("returns undefined for unknown names and non-command lines", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    for (const line of ["/nope", "plain text", "/"]) {
      const exec = await dispatchFaceMethod(runtime, "commands/execute", "e", {
        args: { agentId: sessionId, line },
      });
      expect(exec.result.ok).toBe(true);
      if (exec.result.ok) expect(exec.result.value).toBeUndefined();
    }
    expect(runtime.store.get(sessionId).events.map((e) => e.type)).toEqual([
      "permission/preset",
      "sandbox/mode",
      "approval/policy",
    ]);
  });

  it("lists and executes plugin commands before recipes", async () => {
    const runtime = createBareFaceRuntime({
      store: createMemorySessionStore(),
      loadSlashRecipes: async () => [
        {
          id: "ping",
          title: "Recipe ping",
          description: "recipe",
          parameters: [],
          prompt: "RECIPE",
          instructions: "",
        },
      ],
      plugins: [
        {
          id: "slash-plug",
          kind: "commands",
          commands: [
            {
              name: "ping",
              description: "plugin ping",
              handler: async ({ rawInput }) => ({
                kind: "success",
                text: `plugin:${rawInput.trim()}`,
              }),
            },
          ],
        },
      ],
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const listed = await dispatchFaceMethod(runtime, "commands/list", "l", {
      args: { agentId: sessionId },
    });
    expect(listed.result.ok).toBe(true);
    if (listed.result.ok) {
      expect(listed.result.value).toEqual([
        {
          name: "compact",
          description: "Compact older conversation history",
        },
        {
          name: "goal",
          description: "Set or replace the session goal",
          input: { hint: "objective" },
        },
        {
          name: "permission",
          description:
            "Switch the permission preset (sandbox mode + approval policy)",
          input: { hint: "<preset>" },
        },
        { name: "ping", description: "plugin ping" },
        {
          name: "plan",
          description: "Enter or leave plan mode",
          input: { hint: "[off|message]" },
        },
      ]);
    }

    const exec = await dispatchFaceMethod(runtime, "commands/execute", "e", {
      args: { agentId: sessionId, line: "/ping  hi" },
    });
    expect(exec.result.ok).toBe(true);
    if (exec.result.ok) {
      expect(exec.result.value).toMatchObject({
        result: { kind: "success", text: "plugin:hi" },
      });
    }
  });

  it("logs command/done error when a plugin handler throws", async () => {
    const runtime = createBareFaceRuntime({
      store: createMemorySessionStore(),
      loadSlashRecipes: async () => [],
      plugins: [
        {
          id: "boom",
          kind: "commands",
          commands: [
            {
              name: "boom",
              description: "throws",
              handler: () => {
                throw new Error("nope");
              },
            },
          ],
        },
      ],
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const exec = await dispatchFaceMethod(runtime, "commands/execute", "e", {
      args: { agentId: sessionId, line: "/boom" },
    });
    expect(exec.result.ok).toBe(true);
    if (exec.result.ok) {
      expect(exec.result.value).toMatchObject({
        result: { kind: "error", text: "nope" },
      });
    }
    expect(runtime.store.get(sessionId).events.map((e) => e.type)).toEqual([
      "permission/preset",
      "sandbox/mode",
      "approval/policy",
      "command/run",
      "command/done",
    ]);
  });

  it("errors on unknown session", async () => {
    const runtime = bareRuntime();
    const exec = await dispatchFaceMethod(runtime, "commands/execute", "e", {
      args: { agentId: "missing", line: "/echo x" },
    });
    expect(exec.result.ok).toBe(false);
    if (!exec.result.ok) {
      expect(exec.result.error.code).toBe("session-not-found");
    }
  });
});

describe("/compact", () => {
  it("rejects arguments", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const exec = await dispatchFaceMethod(runtime, "commands/execute", "e", {
      args: { agentId: sessionId, line: "/compact extra" },
    });
    expect(exec.result.ok).toBe(true);
    if (!exec.result.ok) return;
    expect(exec.result.value).toMatchObject({
      result: { kind: "error", text: "Usage: /compact (no arguments)" },
    });
  });

  it("succeeds with no compactable history", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      loadSlashRecipes: async () => [],
      resolveAgent: async (sessionId) =>
        createAgent({
          sessionId,
          store,
          llm: {
            async chat() {
              return { content: "## Objective\n- x", toolCalls: [] };
            },
          },
          tools: createToolRegistry(),
          compaction: { keepTokens: 1 },
        }),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const exec = await dispatchFaceMethod(runtime, "commands/execute", "e", {
      args: { agentId: sessionId, line: "/compact" },
    });
    expect(exec.result.ok).toBe(true);
    if (!exec.result.ok) return;
    expect(exec.result.value).toMatchObject({
      result: { kind: "success", text: "No compactable history yet." },
    });
  });

  it("logs context/compaction reason manual and pins sourceEventSeq", async () => {
    const store = createMemorySessionStore();
    const agents = new Map<string, ReturnType<typeof createAgent>>();
    const runtime = createBareFaceRuntime({
      store,
      loadSlashRecipes: async () => [],
      resolveAgent: async (sessionId) => {
        let agent = agents.get(sessionId);
        if (!agent) {
          agent = createAgent({
            sessionId,
            store,
            llm: {
              async chat() {
                return {
                  content: "## Objective\n- face-compact",
                  toolCalls: [],
                };
              },
            },
            tools: createToolRegistry(),
            compaction: { keepTokens: 1 },
          });
          agents.set(sessionId, agent);
        }
        return agent;
      },
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    runtime.store.append(sessionId, {
      type: "user/message",
      ts: 10,
      turnId: "t0",
      content: "please remember this long thread",
    });
    runtime.store.append(sessionId, {
      type: "assistant/message",
      ts: 11,
      turnId: "t0",
      stepId: "s0",
      content: "noted",
    });

    const exec = await dispatchFaceMethod(runtime, "commands/execute", "e", {
      args: { agentId: sessionId, line: "/compact" },
    });
    expect(exec.result.ok).toBe(true);
    if (!exec.result.ok) return;
    expect(exec.result.value).toMatchObject({
      result: { kind: "success" },
    });
    const text = (exec.result.value as { result: { text: string } }).result
      .text;
    expect(text).toMatch(/^Compacted \d+ history items \(~\d+ tokens\)\.$/);

    const events = runtime.store.get(sessionId).events;
    const compaction = events.find((e) => e.type === "context/compaction");
    expect(compaction).toMatchObject({
      type: "context/compaction",
      reason: "manual",
      summary: "## Objective\n- face-compact",
    });
    const done = events.find((e) => e.type === "command/done");
    expect(done).toMatchObject({
      type: "command/done",
      kind: "success",
      sourceEventSeq: events.indexOf(compaction!) + 1,
    });
  });
});

describe("pluginInventory/list", () => {
  it("lists process plugins and boot entries; cordis stays failed", async () => {
    const runtime = createBareFaceRuntime({
      store: createMemorySessionStore(),
      plugins: [
        { id: "example-tools", kind: "tools" },
        { id: "community-cordis", kind: "cordis" },
      ],
      webPlugins: [{ id: "@deepseek-ai/dsh-client-runtime" }],
    });
    const listed = await dispatchFaceMethod(
      runtime,
      "pluginInventory/list",
      "p",
      {},
    );
    expect(listed.result.ok).toBe(true);
    if (!listed.result.ok) throw new Error("list");
    expect(listed.result.value).toEqual({
      entries: [
        {
          entryId: "example-tools",
          moduleName: "example-tools",
          enabled: true,
          fiberPhase: "active",
        },
        {
          entryId: "community-cordis",
          moduleName: "community-cordis",
          enabled: false,
          fiberPhase: "failed",
        },
        {
          entryId: "@deepseek-ai/dsh-client-runtime",
          moduleName: "@deepseek-ai/dsh-client-runtime",
          enabled: true,
          fiberPhase: "active",
        },
      ],
    });
  });
});

describe("DSH shell remotes that must not 404 / NI", () => {
  it("dynamicCordisRunner/inventory is an empty list (no Cordis apply)", async () => {
    const runtime = bareRuntime();
    expect(faceMethodFromPath("/api/dynamicCordisRunner/inventory")).toBe(
      "dynamicCordisRunner/inventory",
    );
    const listed = await dispatchFaceMethod(
      runtime,
      "dynamicCordisRunner/inventory",
      "c0",
      { args: {} },
    );
    expect(listed.result).toEqual({ ok: true, value: [] });

    const stopped = await dispatchFaceMethod(
      runtime,
      "dynamicCordisRunner/stopFromPanel",
      "c1",
      { args: { agentId: "s", pluginId: "p" } },
    );
    expect(stopped.result.ok).toBe(true);
    if (stopped.result.ok) {
      expect(stopped.result.value).toMatchObject({
        ok: false,
        reason: "not-running",
      });
    }
  });
});
