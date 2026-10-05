import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  listPendingAdmits,
  newSession,
  readSessionEvents,
} from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { bindSessionThreadTools } from "../src/session-thread-tools.js";
import type { HostFrame } from "../src/types.js";
import {
  admittingAgentResolve,
  createBareFaceRuntime,
} from "./helpers/bare-runtime.js";

function collectHost(runtime: ReturnType<typeof createBareFaceRuntime>): HostFrame[] {
  const frames: HostFrame[] = [];
  runtime.bus.subscribeHost((_id, frame) => {
    frames.push(frame);
  });
  return frames;
}

describe("thread_* tools", () => {
  it("lists only attached 主线 rows, not unbound parent sessions", async () => {
    const runtime = createBareFaceRuntime();
    newSession(runtime.store);
    newSession(runtime.store);
    const [a, b] = runtime.store.list();
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    runtime.workspaces.attachSession(a!, runtime.workspaces.defaultId());
    runtime.workspaces.attachSession(b!, runtime.workspaces.defaultId());

    const toolsA = createToolRegistry();
    bindSessionThreadTools(toolsA, { runtime, sessionId: a! });
    const toolsB = createToolRegistry();
    bindSessionThreadTools(toolsB, { runtime, sessionId: b! });

    const noLine = await toolsA.get("sideline_set")!.execute({ text: "正在改" });
    expect(noLine.isError).toBeFalsy();
    expect(runtime.presence.get(a!)?.tips).toBe("正在改");

    const empty = await toolsB.get("thread_list")!.execute({});
    expect(empty.isError).toBeFalsy();
    const emptyBody = JSON.parse(String(empty.content)) as {
      threads: unknown[];
      mains?: unknown;
    };
    expect(emptyBody.mains).toBeUndefined();
    expect(emptyBody.threads).toEqual([]);

    const upsert = await toolsA.get("thread_upsert")!.execute({
      title: "发版手册",
      brief: "写完 0.5.11 发行说明",
    });
    expect(upsert.isError).toBeFalsy();
    const upsertBody = JSON.parse(String(upsert.content)) as { thread: { id: string } };

    const listed = await toolsB.get("thread_list")!.execute({});
    expect(listed.isError).toBeFalsy();
    const body = JSON.parse(String(listed.content)) as {
      threads: Array<{
        title: string;
        sessions: Array<{ sessionId: string; self: boolean; sideline?: string }>;
      }>;
    };
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0]?.title).toBe("发版手册");
    expect(body.threads[0]?.sessions.map((row) => row.sessionId)).toEqual([a]);
    expect(body.threads[0]?.sessions[0]?.self).toBe(false);
    expect(body.threads[0]?.sessions[0]?.sideline).toBe("正在改");

    const deleted = await toolsA.get("thread_delete")!.execute({ id: upsertBody.thread.id });
    expect(deleted.isError).toBeFalsy();
    const after = await toolsB.get("thread_list")!.execute({});
    const afterBody = JSON.parse(String(after.content)) as { threads: unknown[] };
    expect(afterBody.threads).toEqual([]);
  });

  it("publishes host/session-thread so the shell can rename the sidebar", async () => {
    const runtime = createBareFaceRuntime();
    const host = collectHost(runtime);
    newSession(runtime.store);
    const [sessionId] = runtime.store.list();
    expect(sessionId).toBeDefined();
    runtime.workspaces.attachSession(sessionId!, runtime.workspaces.defaultId());

    const tools = createToolRegistry();
    bindSessionThreadTools(tools, { runtime, sessionId: sessionId! });

    const upsert = await tools.get("thread_upsert")!.execute({
      title: "被讨厌的 AI 售后部",
    });
    expect(upsert.isError).toBeFalsy();
    const upsertBody = JSON.parse(String(upsert.content)) as { thread: { id: string } };

    const bound = host.filter(
      (frame): frame is Extract<HostFrame, { type: "host/session-thread" }> =>
        frame.type === "host/session-thread",
    );
    expect(bound.at(-1)).toMatchObject({
      sessionId,
      bound: true,
      mainline: "被讨厌的 AI 售后部",
      mainlineId: upsertBody.thread.id,
    });

    host.length = 0;
    const revised = await tools.get("thread_upsert")!.execute({
      id: upsertBody.thread.id,
      title: "修好了再讨厌",
    });
    expect(revised.isError).toBeFalsy();
    expect(host.filter((frame) => frame.type === "host/session-thread").at(-1)).toMatchObject({
      sessionId,
      bound: true,
      mainline: "修好了再讨厌",
      mainlineId: upsertBody.thread.id,
    });

    host.length = 0;
    const deleted = await tools.get("thread_delete")!.execute({ id: upsertBody.thread.id });
    expect(deleted.isError).toBeFalsy();
    expect(host.filter((frame) => frame.type === "host/session-thread").at(-1)).toMatchObject({
      sessionId,
      bound: false,
    });
  });

  it("delivers thread_message as steer, not Settings queue", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
    });
    newSession(store);
    newSession(store);
    const [a, b] = store.list();
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    const ws = runtime.workspaces.defaultId();
    runtime.workspaces.attachSession(a!, ws);
    runtime.workspaces.attachSession(b!, ws);

    const toolsA = createToolRegistry();
    bindSessionThreadTools(toolsA, { runtime, sessionId: a! });
    const toolsB = createToolRegistry();
    bindSessionThreadTools(toolsB, { runtime, sessionId: b! });
    expect((await toolsA.get("thread_upsert")!.execute({ title: "发信方" })).isError).toBeFalsy();
    expect((await toolsB.get("thread_upsert")!.execute({ title: "收信方" })).isError).toBeFalsy();

    const sent = await toolsA.get("thread_message")!.execute({
      session_id: b,
      message: "hello peer",
      wait: false,
    });
    expect(sent.isError).toBeFalsy();
    expect(String(sent.content)).toContain("steer");
    const pending = listPendingAdmits(readSessionEvents(store, b!), b!);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.delivery).toBe("steer");
    expect(String(pending[0]?.content)).toContain("hello peer");
  });
});
