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

    // 支线由 `presence_set` 写入同一 store；这里直接写（主线已绑），验证
    // thread_list 会把 sideline 带出来。
    runtime.sessionThreads.setSideline(
      runtime.workspaces.defaultId(),
      a!,
      "正在改",
    );

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

  it("delivers thread_message as steer without either side on a 主线", async () => {
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
    expect(String(pending[0]?.content)).toContain("会话协作");
  });

  it("thread_upsert can pin another session in its workspace", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({ store });
    newSession(store);
    newSession(store);
    const [a, b] = store.list();
    const ws = runtime.workspaces.defaultId();
    runtime.workspaces.attachSession(a!, ws);
    runtime.workspaces.attachSession(b!, ws);
    const tools = createToolRegistry();
    bindSessionThreadTools(tools, { runtime, sessionId: a! });
    const out = await tools.get("thread_upsert")!.execute({
      title: "远端施工",
      session_id: b,
      workspace_id: ws,
    });
    expect(out.isError).toBeFalsy();
    const bind = runtime.sessionThreads.bindOf(ws, b!);
    expect(bind?.threadId).toBeTruthy();
    expect(runtime.sessionThreads.get(ws, bind!.threadId)?.title).toBe("远端施工");
  });

  it("siblingScope=none blocks child↔child thread_message", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({ store });
    newSession(store);
    newSession(store);
    newSession(store);
    const [parent, a, b] = store.list();
    const ws = runtime.workspaces.defaultId();
    for (const id of [parent!, a!, b!]) {
      runtime.workspaces.attachSession(id, ws);
    }
    runtime.subagents.attach({
      childSessionId: a!,
      parentSessionId: parent!,
      role: "worker",
      status: "idle",
      startedAt: 0,
      mode: "in-process",
      toolSurface: "minimal",
    } as never);
    runtime.subagents.attach({
      childSessionId: b!,
      parentSessionId: parent!,
      role: "worker",
      status: "idle",
      startedAt: 0,
      mode: "in-process",
      toolSurface: "minimal",
    } as never);
    runtime.agentTeams.recordDelegation({
      childSessionId: a!,
      parentSessionId: parent!,
      role: "worker",
      status: "idle",
      startedAt: 0,
      mode: "in-process",
      toolSurface: "minimal",
      label: "a",
    } as never);
    runtime.agentTeams.recordDelegation({
      childSessionId: b!,
      parentSessionId: parent!,
      role: "worker",
      status: "idle",
      startedAt: 0,
      mode: "in-process",
      toolSurface: "minimal",
      label: "b",
    } as never);

    Object.assign(runtime.settingsNamespaces.ensure("workspace-discovery").user, {
      siblingScope: "none",
    });

    const tools = createToolRegistry();
    bindSessionThreadTools(tools, {
      runtime,
      sessionId: a!,
      ownLane: true,
    });
    const out = await tools.get("thread_message")!.execute({
      session_id: b,
      message: "hi sibling",
      wait: false,
    });
    expect(out.isError).toBeTruthy();
    expect(String(out.content)).toMatch(/siblingScope=none/);
  });

  it("ownLane children mint self pins but cannot revise or delete shared pins", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({ store });
    newSession(store);
    newSession(store);
    const [parent, child] = store.list();
    const ws = runtime.workspaces.defaultId();
    runtime.workspaces.attachSession(parent!, ws);
    runtime.workspaces.attachSession(child!, ws);
    runtime.subagents.attach({
      childSessionId: child!,
      parentSessionId: parent!,
      role: "worker",
      status: "idle",
      startedAt: 0,
      mode: "in-process",
      toolSurface: "minimal",
    } as never);

    const parentTools = createToolRegistry();
    bindSessionThreadTools(parentTools, { runtime, sessionId: parent! });
    const parentPin = await parentTools.get("thread_upsert")!.execute({
      title: "父主线",
      brief: "parent mission",
    });
    expect(parentPin.isError).toBeFalsy();
    const parentThreadId = (
      JSON.parse(String(parentPin.content)) as { thread: { id: string } }
    ).thread.id;

    const childTools = createToolRegistry();
    bindSessionThreadTools(childTools, {
      runtime,
      sessionId: child!,
      ownLane: true,
    });
    expect(childTools.get("thread_upsert")).toBeTruthy();
    expect(childTools.get("thread_delete")).toBeTruthy();

    const peerPin = await childTools.get("thread_upsert")!.execute({
      title: "偷改父钉",
      id: parentThreadId,
    });
    expect(peerPin.isError).toBeTruthy();
    expect(String(peerPin.content)).toMatch(/own-lane may only revise/);

    const foreignDelete = await childTools.get("thread_delete")!.execute({
      id: parentThreadId,
    });
    expect(foreignDelete.isError).toBeTruthy();
    expect(String(foreignDelete.content)).toMatch(/bound to/);

    // Landing on the parent pin via switch must not unlock rewrite of a shared mission.
    const switched = await childTools.get("thread_switch")!.execute({
      id: parentThreadId,
    });
    expect(switched.isError).toBeFalsy();
    const sharedRevise = await childTools.get("thread_upsert")!.execute({
      title: "改共享主线",
      id: parentThreadId,
    });
    expect(sharedRevise.isError).toBeTruthy();
    expect(String(sharedRevise.content)).toMatch(/shared with other sessions/);

    const own = await childTools.get("thread_upsert")!.execute({
      title: "子主线",
      brief: "child mission",
    });
    expect(own.isError).toBeFalsy();
    const ownId = (
      JSON.parse(String(own.content)) as { thread: { id: string } }
    ).thread.id;
    const deleted = await childTools.get("thread_delete")!.execute({ id: ownId });
    expect(deleted.isError).toBeFalsy();
  });
});
