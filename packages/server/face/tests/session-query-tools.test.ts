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
    });

    const tools = createToolRegistry();
    bindSessionQueryTools(tools, { runtime, parentSessionId: parent });
    expect(tools.get("session_search")).toBeTruthy();
    expect(tools.get("session_read")).toBeTruthy();
    expect(tools.get("session_trace")).toBeTruthy();
    expect(SESSION_QUERY_ROUTING_PROMPT_TEXT).toContain("session_search");

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
      descendants: { id: string }[];
    };
    expect(traceBody.descendants.some((d) => d.id === other.id)).toBe(true);
  });
});
