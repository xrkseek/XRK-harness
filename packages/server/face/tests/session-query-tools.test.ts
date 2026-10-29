import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import {
  bindSessionQueryTools,
  SESSION_QUERY_ROUTING_PROMPT_TEXT,
} from "../src/session-query-tools.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  admittingAgentResolve,
  createBareFaceRuntime,
} from "./helpers/bare-runtime.js";

describe("session query tools", () => {
  it("exposes search / read / trace with workspace authority", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const parent = (created.result.value as { sessionId: string }).sessionId;
    runtime.sessionCwds.set(parent, runtime.workspaceRoot);

    const other = store.create("other-hit");
    runtime.sessionCwds.set(other.id, runtime.workspaceRoot);
    store.append(other.id, {
      type: "turn/start",
      ts: 1,
      turnId: "t0",
    });
    store.append(other.id, {
      type: "user/message",
      ts: 2,
      turnId: "t0",
      content: "needle ALPHA in prior chat",
      source: { kind: "user" },
    });
    store.append(other.id, {
      type: "assistant/message",
      ts: 3,
      turnId: "t0",
      stepId: "s0",
      content: "noted ALPHA",
    });

    const outsider = store.create("other-cwd");
    runtime.sessionCwds.set(outsider.id, `${runtime.workspaceRoot}-elsewhere`);
    store.append(outsider.id, {
      type: "user/message",
      ts: 4,
      turnId: "t1",
      content: "needle ALPHA elsewhere",
      source: { kind: "user" },
    });

    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: other.id,
      mode: "one-shot",
      label: "worker",
      memberId: "op-alpha",
    });

    const tools = createToolRegistry();
    bindSessionQueryTools(tools, { runtime, parentSessionId: parent });
    expect(tools.get("session_inspect")).toBeTruthy();
    expect(tools.get("session_search")).toBeTruthy();
    expect(tools.get("session_read")).toBeTruthy();
    expect(tools.get("session_event_window")).toBeTruthy();
    expect(tools.get("session_trace")).toBeTruthy();
    expect(SESSION_QUERY_ROUTING_PROMPT_TEXT).toContain("session_inspect");
    expect(SESSION_QUERY_ROUTING_PROMPT_TEXT).toContain("session_search");
    expect(SESSION_QUERY_ROUTING_PROMPT_TEXT).toContain("session_event_window");

    const inspectSelf = await tools.get("session_inspect")!.execute({
      session_id: parent,
    });
    expect(inspectSelf.isError).toBeFalsy();
    const inspectSelfBody = JSON.parse(String(inspectSelf.content)) as {
      sessionId: string;
      badge: string;
      children: { id: string }[];
    };
    expect(inspectSelfBody.sessionId).toBe(parent);
    expect(inspectSelfBody.badge).toBeTruthy();
    expect(inspectSelfBody.children.some((c) => c.id === other.id)).toBe(true);

    const inspectChild = await tools.get("session_inspect")!.execute({
      session_id: other.id,
    });
    expect(inspectChild.isError).toBeFalsy();
    const inspectChildBody = JSON.parse(String(inspectChild.content)) as {
      memberId?: string;
      delegate?: { parentSessionId: string; label?: string };
    };
    expect(inspectChildBody.memberId).toBe("op-alpha");
    expect(inspectChildBody.delegate?.parentSessionId).toBe(parent);

    const inspectOutsider = await tools.get("session_inspect")!.execute({
      session_id: outsider.id,
    });
    expect(inspectOutsider.isError).toBeFalsy();
    const inspectOutsiderBody = JSON.parse(String(inspectOutsider.content)) as {
      sessionId: string;
      cwd: string;
    };
    expect(inspectOutsiderBody.sessionId).toBe(outsider.id);
    expect(inspectOutsiderBody.cwd).toContain("elsewhere");

    const inspectMissing = await tools.get("session_inspect")!.execute({
      session_id: "missing-session",
    });
    expect(inspectMissing.isError).toBe(true);

    const search = await tools.get("session_search")!.execute({
      query: "ALPHA",
    });
    expect(search.isError).toBeFalsy();
    const searchBody = JSON.parse(String(search.content)) as {
      items: { sessionId: string }[];
    };
    expect(searchBody.items.map((i) => i.sessionId)).toEqual([other.id]);

    const denied = await tools.get("session_read")!.execute({
      session_id: outsider.id,
    });
    expect(denied.isError).toBe(true);
    expect(String(denied.content)).toMatch(/cwd mismatch/);

    const read = await tools.get("session_read")!.execute({
      session_id: other.id,
      label: "Alpha",
    });
    expect(read.isError).toBeFalsy();
    expect(String(read.content)).toContain("UNTRUSTED");
    expect(String(read.content)).toContain("needle ALPHA");

    const trace = await tools.get("session_trace")!.execute({});
    expect(trace.isError).toBeFalsy();
    const traceBody = JSON.parse(String(trace.content)) as {
      descendants: { id: string; via?: string }[];
      complete: boolean;
      truncated: boolean;
    };
    expect(traceBody.descendants.some((d) => d.id === other.id)).toBe(true);
    expect(traceBody.complete).toBe(true);
    expect(traceBody.truncated).toBe(false);

    // Host may append `session/title` after the user message; locate the
    // user/message seq instead of assuming a fixed 3-event prefix.
    const peekAll = await tools.get("session_event_window")!.execute({
      session_id: other.id,
      seq: 1,
      before: 0,
      after: 20,
    });
    expect(peekAll.isError).toBeFalsy();
    const peekBody = JSON.parse(String(peekAll.content)) as {
      events: { seq: number; type: string }[];
    };
    const userSeq = peekBody.events.find((e) => e.type === "user/message")?.seq;
    expect(userSeq).toEqual(expect.any(Number));

    const win = await tools.get("session_event_window")!.execute({
      session_id: other.id,
      seq: userSeq,
      before: 1,
      after: 1,
    });
    expect(win.isError).toBeFalsy();
    const winBody = JSON.parse(String(win.content)) as {
      seq: number;
      events: { seq: number; type: string }[];
    };
    expect(winBody.seq).toBe(userSeq);
    expect(winBody.events.some((e) => e.type === "user/message")).toBe(true);
    expect(winBody.events.length).toBeGreaterThanOrEqual(2);

    // Unique id: FaceForkLineageStore persists under product home and
    // `attach` refuses to overwrite an existing child→parent edge.
    const forkChild = store.create(`fork-child-${parent}`);
    runtime.sessionCwds.set(forkChild.id, runtime.workspaceRoot);
    runtime.forkLineage.attach({
      parentSessionId: parent,
      childSessionId: forkChild.id,
    });
    const forkTrace = await tools.get("session_trace")!.execute({
      session_id: forkChild.id,
    });
    expect(forkTrace.isError).toBeFalsy();
    const forkBody = JSON.parse(String(forkTrace.content)) as {
      ancestors: { id: string; via?: string }[];
    };
    expect(forkBody.ancestors.some((a) => a.id === parent && a.via === "fork")).toBe(
      true,
    );

    const rpc = await dispatchFaceMethod(
      runtime,
      "session.eventWindow",
      "ew1",
      { sessionId: other.id, seq: userSeq, before: 0, after: 0 },
    );
    expect(rpc.result.ok).toBe(true);
    if (rpc.result.ok) {
      const v = rpc.result.value as { events: { type: string }[] };
      expect(v.events).toHaveLength(1);
      expect(v.events[0]!.type).toBe("user/message");
    }
  });
});
