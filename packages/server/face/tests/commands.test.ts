import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  admitPrompt,
} from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { faceMethodFromPath } from "../src/wire/index.js";

function bareRuntime(store = createMemorySessionStore()) {
  return createFaceRuntime({
    store,
    workspaceRoot: process.cwd(),
    version: "test",
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
    drain: {
      wake() {},
      async cancel() {},
      isActive() {
        return false;
      },
    },
    resolveAgent: async (sessionId) => ({
      admit: (content, opts) => admitPrompt(store, sessionId, content, opts),
      pendingAdmits: () => [],
      continueTurn: async () => ({}) as never,
      run: async () => ({}) as never,
      isBusy: () => false,
      abort() {},
    }),
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
          name: "echo",
          description: "echo args",
          input: { hint: "text" },
        },
        {
          name: "goal",
          description: "Set or replace the session goal",
          input: { hint: "objective" },
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
    expect(events.map((e) => e.type)).toEqual(["command/run", "command/done"]);
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
    expect(runtime.store.get(sessionId).events).toHaveLength(0);
  });

  it("lists and executes plugin commands before recipes", async () => {
    const runtime = createFaceRuntime({
      store: createMemorySessionStore(),
      workspaceRoot: process.cwd(),
      version: "test",
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
      drain: {
        wake() {},
        async cancel() {},
        isActive() {
          return false;
        },
      },
      resolveAgent: async () => ({
        admit: () => ({}) as never,
        pendingAdmits: () => [],
        continueTurn: async () => ({}) as never,
        run: async () => ({}) as never,
        isBusy: () => false,
        abort() {},
      }),
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
          name: "goal",
          description: "Set or replace the session goal",
          input: { hint: "objective" },
        },
        { name: "ping", description: "plugin ping" },
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
    const runtime = createFaceRuntime({
      store: createMemorySessionStore(),
      workspaceRoot: process.cwd(),
      version: "test",
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
      drain: {
        wake() {},
        async cancel() {},
        isActive() {
          return false;
        },
      },
      resolveAgent: async () => ({
        admit: () => ({}) as never,
        pendingAdmits: () => [],
        continueTurn: async () => ({}) as never,
        run: async () => ({}) as never,
        isBusy: () => false,
        abort() {},
      }),
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

describe("pluginInventory/list", () => {
  it("lists process plugins and boot entries; cordis stays failed", async () => {
    const runtime = createFaceRuntime({
      store: createMemorySessionStore(),
      workspaceRoot: process.cwd(),
      version: "test",
      plugins: [
        { id: "example-tools", kind: "tools" },
        { id: "community-cordis", kind: "cordis" },
      ],
      webPlugins: [{ id: "@deepseek-ai/dsh-client-runtime" }],
      drain: {
        wake() {},
        async cancel() {},
        isActive() {
          return false;
        },
      },
      resolveAgent: async () => ({
        admit: () => ({}) as never,
        pendingAdmits: () => [],
        continueTurn: async () => ({}) as never,
        run: async () => ({}) as never,
        isBusy: () => false,
        abort() {},
      }),
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
