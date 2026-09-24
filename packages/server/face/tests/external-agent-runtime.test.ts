import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { createFaceRuntime } from "../src/runtime.js";
import { bindSubagentTools } from "../src/subagent-tools.js";
import {
  parseExternalAgentKind,
  resolveExternalAgentLaunch,
  runExternalAgentTurn,
} from "../src/external-agent-runtime.js";
import type { FaceDrain } from "../src/context.js";
import type { AgentHandle } from "@xrkseek/core-agent";

function stubAgent(): AgentHandle {
  return {
    admit(content, options) {
      return {
        admitId: options?.admitId ?? "a",
        sessionId: "s",
        content,
        delivery: options?.delivery ?? "queue",
      };
    },
    pendingAdmits() {
      return [];
    },
    abort() {},
    isBusy() {
      return false;
    },
    setApprovalHandler() {},
    async continueTurn() {
      return { text: "", events: [] };
    },
    async run() {
      return { text: "", events: [] };
    },
  } as AgentHandle;
}

function drain(): FaceDrain {
  return {
    wake() {},
    async cancel() {},
    isActive() {
      return false;
    },
    async run() {},
  };
}

function fakeChild(
  handler: (stdinLine: string, write: (obj: unknown) => void) => void,
): ChildProcessWithoutNullStreams {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  Object.assign(child, {
    stdin,
    stdout,
    stderr,
    killed: false,
    exitCode: null as number | null,
    kill() {
      child.killed = true;
      child.exitCode = 0;
      child.emit("close", 0);
    },
  });
  const write = (obj: unknown): void => {
    stdout.write(`${JSON.stringify(obj)}\n`);
  };
  let buf = "";
  stdin.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf8");
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim()) handler(line.trim(), write);
    }
  });
  stdin.on("end", () => {
    if (child.exitCode === null) {
      child.exitCode = 0;
      child.emit("close", 0);
    }
  });
  return child;
}

describe("external agent runtime", () => {
  it("parses runtime kinds", () => {
    expect(parseExternalAgentKind(undefined)).toBe("in-process");
    expect(parseExternalAgentKind("acp")).toBe("acp");
    expect(parseExternalAgentKind("APP-SERVER")).toBe("app-server");
    expect(parseExternalAgentKind("nope")).toBeUndefined();
  });

  it("resolves launch env honestly", () => {
    expect(() =>
      resolveExternalAgentLaunch("acp", {}, "hi"),
    ).toThrow(/XRK_ACP_AGENT|external-agent\.acpAgent/);
    expect(
      resolveExternalAgentLaunch(
        "acp",
        { XRK_ACP_AGENT: "node fake-acp.js" },
        "hi",
      ),
    ).toEqual({
      command: "node",
      args: ["fake-acp.js"],
      protocol: "acp",
    });
    expect(
      resolveExternalAgentLaunch("claude-code", {}, "do it"),
    ).toEqual({
      command: "claude",
      args: ["-p", "do it"],
      protocol: "print",
    });
  });

  it("prefers product when env is unset, and env when set", () => {
    expect(
      resolveExternalAgentLaunch("acp", {}, "hi", { acpAgent: "xrkh acp" }),
    ).toEqual({ command: "xrkh", args: ["acp"], protocol: "acp" });
    expect(
      resolveExternalAgentLaunch(
        "acp",
        { XRK_ACP_AGENT: "env-acp" },
        "hi",
        { acpAgent: "xrkh acp" },
      ),
    ).toEqual({ command: "env-acp", args: [], protocol: "acp" });
    expect(
      resolveExternalAgentLaunch(
        "app-server",
        {},
        "hi",
        { codexAppServer: "my-codex serve" },
      ),
    ).toEqual({
      command: "my-codex",
      args: ["serve"],
      protocol: "app-server",
    });
    expect(
      resolveExternalAgentLaunch(
        "claude-code",
        {},
        "do it",
        { claudeCode: "/opt/claude" },
      ),
    ).toEqual({
      command: "/opt/claude",
      args: ["-p", "do it"],
      protocol: "print",
    });
  });

  it("runs ACP one-shot via injectable spawn", async () => {
    const result = await runExternalAgentTurn({
      kind: "acp",
      cwd: "/tmp/ws",
      prompt: "say hi",
      env: { XRK_ACP_AGENT: "fake-acp" },
      spawnImpl: () =>
        fakeChild((line, write) => {
          const msg = JSON.parse(line) as {
            id?: number;
            method?: string;
            params?: { prompt?: unknown };
          };
          if (msg.method === "initialize") {
            write({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1 } });
            return;
          }
          if (msg.method === "session/new") {
            write({
              jsonrpc: "2.0",
              id: msg.id,
              result: { sessionId: "acp_test" },
            });
            return;
          }
          if (msg.method === "session/prompt") {
            write({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                sessionId: "acp_test",
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "hello-from-acp" },
                },
              },
            });
            write({
              jsonrpc: "2.0",
              id: msg.id,
              result: { stopReason: "end_turn" },
            });
          }
        }),
    });
    expect(result.kind).toBe("acp");
    expect(result.text).toBe("hello-from-acp");
  });

  it("runs app-server one-shot via injectable spawn", async () => {
    const result = await runExternalAgentTurn({
      kind: "app-server",
      cwd: "/tmp/ws",
      prompt: "say hi",
      env: { XRK_CODEX_APP_SERVER: "fake-app-server" },
      spawnImpl: () =>
        fakeChild((line, write) => {
          const msg = JSON.parse(line) as {
            id?: number;
            method?: string;
          };
          if (msg.method === "initialize") {
            write({ jsonrpc: "2.0", id: msg.id, result: {} });
            return;
          }
          if (msg.method === "initialized") return;
          if (msg.method === "thread/start") {
            write({
              jsonrpc: "2.0",
              id: msg.id,
              result: { thread: { id: "th1", ephemeral: true } },
            });
            return;
          }
          if (msg.method === "turn/start") {
            write({
              jsonrpc: "2.0",
              id: msg.id,
              result: { turn: { id: "tu1" } },
            });
            write({
              jsonrpc: "2.0",
              method: "item/completed",
              params: {
                threadId: "th1",
                turnId: "tu1",
                item: {
                  type: "agentMessage",
                  text: "hello-from-codex",
                  phase: "final_answer",
                },
              },
            });
            write({
              jsonrpc: "2.0",
              method: "turn/completed",
              params: {
                threadId: "th1",
                turn: { id: "tu1", status: "completed" },
              },
            });
          }
        }),
    });
    expect(result.text).toBe("hello-from-codex");
  });

  it("subagent tool external path does not create Face children", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      resolveAgent: async () => stubAgent(),
    });
    const parent = runtime.ensureSession("parent");
    const tools = createToolRegistry();
    bindSubagentTools(tools, {
      runtime,
      parentSessionId: parent,
      externalEnv: { XRK_ACP_AGENT: "fake-acp" },
      externalSpawn: () =>
        fakeChild((line, write) => {
          const msg = JSON.parse(line) as { id?: number; method?: string };
          if (msg.method === "initialize") {
            write({ jsonrpc: "2.0", id: msg.id, result: {} });
            return;
          }
          if (msg.method === "session/new") {
            write({
              jsonrpc: "2.0",
              id: msg.id,
              result: { sessionId: "acp_x" },
            });
            return;
          }
          if (msg.method === "session/prompt") {
            write({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                update: { content: { type: "text", text: "ext-ok" } },
              },
            });
            write({
              jsonrpc: "2.0",
              id: msg.id,
              result: { stopReason: "end_turn" },
            });
          }
        }),
    });
    const out = await tools.get("subagent")!.execute({
      prompt: "go",
      runtime: "acp",
    });
    expect(out.isError).toBeFalsy();
    expect(out.content).toMatch(/\[external:acp\]/);
    expect(out.content).toMatch(/ext-ok/);
    expect(runtime.subagents.listDelegated(parent)).toEqual([]);
  });

  it("rejects background for claude-code print protocol", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      resolveAgent: async () => stubAgent(),
    });
    const parent = runtime.ensureSession("parent");
    const tools = createToolRegistry();
    bindSubagentTools(tools, { runtime, parentSessionId: parent });
    const out = await tools.get("subagent")!.execute({
      prompt: "go",
      runtime: "claude-code",
      run_in_background: true,
    });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/claude-code/);
  });

  it("starts continuable ACP external child on the same list surface", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      resolveAgent: async () => stubAgent(),
    });
    const parent = runtime.ensureSession("parent");
    const tools = createToolRegistry();
    let prompts = 0;
    bindSubagentTools(tools, {
      runtime,
      parentSessionId: parent,
      externalEnv: { XRK_ACP_AGENT: "fake-acp" },
      externalSpawn: () =>
        fakeChild((line, write) => {
          const msg = JSON.parse(line) as { id?: number; method?: string };
          if (msg.method === "initialize") {
            write({ jsonrpc: "2.0", id: msg.id, result: {} });
            return;
          }
          if (msg.method === "session/new") {
            write({
              jsonrpc: "2.0",
              id: msg.id,
              result: { sessionId: "acp_live" },
            });
            return;
          }
          if (msg.method === "session/prompt") {
            prompts += 1;
            write({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                update: {
                  content: { type: "text", text: `ext-turn-${prompts}` },
                },
              },
            });
            write({
              jsonrpc: "2.0",
              id: msg.id,
              result: { stopReason: "end_turn" },
            });
          }
        }),
    });
    const out = await tools.get("subagent")!.execute({
      prompt: "first",
      runtime: "acp",
      run_in_background: true,
      description: "ext-worker",
    });
    expect(out.isError).toBeFalsy();
    expect(out.content).toMatch(/background external/);
    const children = runtime.subagents.listDelegated(parent);
    expect(children).toHaveLength(1);
    const childId = children[0]!.childSessionId;
    expect(runtime.externalAgents.has(childId)).toBe(true);

    await vi.waitFor(() => {
      expect(prompts).toBeGreaterThanOrEqual(1);
    });

    const follow = await tools.get("followup_task")!.execute({
      agent_id: childId,
      message: "second",
    });
    expect(follow.isError).not.toBe(true);
    await vi.waitFor(() => {
      expect(prompts).toBeGreaterThanOrEqual(2);
    });

    const wait = await tools.get("wait_agent")!.execute({
      agent_id: childId,
      timeout_ms: 2000,
    });
    expect(wait.isError).not.toBe(true);
    expect(wait.content).toMatch(/ext-turn/);

    const stopped = await tools.get("interrupt_agent")!.execute({
      agent_id: childId,
    });
    expect(stopped.isError).not.toBe(true);
    expect(runtime.externalAgents.has(childId)).toBe(false);
  });

  it("fails honestly when ACP agent env is missing", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      resolveAgent: async () => stubAgent(),
    });
    const parent = runtime.ensureSession("parent");
    const tools = createToolRegistry();
    bindSubagentTools(tools, {
      runtime,
      parentSessionId: parent,
      externalEnv: {},
    });
    const out = await tools.get("subagent")!.execute({
      prompt: "go",
      runtime: "acp",
    });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/XRK_ACP_AGENT/);
  });
});
