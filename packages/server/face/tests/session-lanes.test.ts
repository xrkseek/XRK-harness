import { describe, expect, it } from "vitest";
import { newSession } from "@xrkseek/core-session";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";
import {
  createSessionLanesFragmentProvider,
  formatSessionLanes,
} from "../src/session-lanes.js";
import { listSessionInjectDocuments } from "../src/session-inject-documents.js";
import { createToolRegistry } from "@xrkseek/core-tools";
import { bindSessionThreadTools } from "../src/session-thread-tools.js";

describe("session_lanes fragment", () => {
  it("always emits a lanes card for known sessions", () => {
    const runtime = createBareFaceRuntime();
    newSession(runtime.store);
    const [sessionId] = runtime.store.list();
    expect(sessionId).toBeDefined();
    runtime.workspaces.attachSession(
      sessionId!,
      runtime.workspaces.defaultId(),
    );

    const text = formatSessionLanes(runtime, sessionId!);
    // Idle first-turn card: one short line (no lecture).
    expect(text).toContain("idle");
    expect(text).toContain("todo_write");
    expect(text).not.toContain("主线: none");
    expect(text.length).toBeLessThan(160);

    const frags = createSessionLanesFragmentProvider(runtime).produce({
      sessionId: sessionId!,
    });
    expect(frags).toHaveLength(1);
    expect(frags[0]?.text).toContain("<session_lanes>");
    expect(frags[0]?.priority).toBe(8.25);

    const docs = listSessionInjectDocuments(runtime, sessionId!);
    expect(docs.some((d) => d.kind === "session-lanes")).toBe(true);
  });

  it("reflects a pinned 主线 after thread_upsert", async () => {
    const runtime = createBareFaceRuntime();
    newSession(runtime.store);
    const [sessionId] = runtime.store.list();
    expect(sessionId).toBeDefined();
    runtime.workspaces.attachSession(
      sessionId!,
      runtime.workspaces.defaultId(),
    );
    const tools = createToolRegistry();
    bindSessionThreadTools(tools, { runtime, sessionId: sessionId! });
    const upsert = await tools.get("thread_upsert")!.execute({
      title: "发版 0.8",
      brief: "lanes + identity sync",
    });
    expect(upsert.isError).toBeFalsy();

    const text = formatSessionLanes(runtime, sessionId!);
    expect(text).toContain("发版 0.8");
    expect(text).toContain("lanes + identity sync");
  });
});
