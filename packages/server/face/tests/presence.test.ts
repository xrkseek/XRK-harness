import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry, materializeTools } from "@xrkseek/core-tools";
import { FacePresenceStore } from "../src/presence-store.js";
import { bindPresenceTools } from "../src/presence-tools.js";
import {
  buildSessionStatusSnapshot,
  formatSessionStatusText,
} from "../src/session-status.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  admittingAgentResolve,
  createBareFaceRuntime,
} from "./helpers/bare-runtime.js";

describe("FacePresenceStore", () => {
  it("sets, gets, clears, and forgets sticky presence", () => {
    const store = new FacePresenceStore();
    expect(store.get("s1")).toBeUndefined();
    const row = store.set("s1", { emotionId: "30", tips: " thinking " });
    expect(row.emotionId).toBe("30");
    expect(row.tips).toBe("thinking");
    expect(row.source).toBe("tool");
    expect(store.get("s1")?.emotionId).toBe("30");
    expect(store.size()).toBe(1);
    expect(store.clear("s1")).toBe(true);
    expect(store.get("s1")).toBeUndefined();
    store.set("s2", { emotionId: "10" });
    store.forget("s2");
    expect(store.size()).toBe(0);
  });
});

describe("presence_set tool", () => {
  it("writes sticky presence and clears on auto", async () => {
    const shared = createBareFaceRuntime();
    const tools = createToolRegistry();
    bindPresenceTools(tools, { runtime: shared, sessionId: "sess-a" });
    const tool = tools.get("presence_set");
    expect(tool).toBeDefined();

    const setResult = await tool!.execute({
      emotionId: "33",
      tips: "done",
    });
    expect(setResult.isError).toBeFalsy();
    expect(shared.presence.get("sess-a")?.emotionId).toBe("33");
    expect(shared.presence.get("sess-a")?.tips).toBe("done");

    const bad = await tool!.execute({ emotionId: "nope" });
    expect(bad.isError).toBe(true);

    const cleared = await tool!.execute({ emotionId: "auto" });
    expect(cleared.isError).toBeFalsy();
    expect(shared.presence.get("sess-a")).toBeUndefined();
  });

  it("keeps materialize identity across resolveAgent rebinds", async () => {
    const shared = createBareFaceRuntime();
    const tools = createToolRegistry();
    bindPresenceTools(tools, { runtime: shared, sessionId: "sess-b" });
    const table = materializeTools(tools);
    // Second bind must not mint a new ToolDefinition (stale settle).
    bindPresenceTools(tools, { runtime: shared, sessionId: "sess-b" });
    const settled = await table.settle({
      call: {
        id: "c1",
        name: "presence_set",
        arguments: { emotionId: "03", tips: "突然被问心情" },
      },
    });
    expect(settled.result.content).not.toContain("Stale tool call");
    expect(settled.result.isError).toBeFalsy();
    expect(shared.presence.get("sess-b")?.emotionId).toBe("03");
  });
});

describe("session status presence", () => {
  it("surfaces sticky presence on snapshot and /status text", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const before = buildSessionStatusSnapshot(runtime, sessionId);
    expect(before.presence).toBeUndefined();
    expect(formatSessionStatusText(before)).toContain("presence: (auto");

    runtime.presence.set(sessionId, { emotionId: "40", tips: "searching" });
    const after = buildSessionStatusSnapshot(runtime, sessionId);
    expect(after.presence).toEqual(
      expect.objectContaining({
        emotionId: "40",
        tips: "searching",
        source: "tool",
      }),
    );
    expect(formatSessionStatusText(after)).toContain("presence: 40 (searching)");
  });
});
