import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import {
  buildSessionStatusSnapshot,
  formatSessionStatusText,
} from "../src/session-status.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  admittingAgentResolve,
  createBareFaceRuntime,
} from "./helpers/bare-runtime.js";

function bareRuntime(store = createMemorySessionStore()) {
  return createBareFaceRuntime({
    store,
    resolveAgent: admittingAgentResolve(store),
  });
}

describe("session status snapshot", () => {
  it("builds shared facts for /status and session.status", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const snap = buildSessionStatusSnapshot(runtime, sessionId);
    expect(snap.sessionId).toBe(sessionId);
    expect(snap.theme).toBe("system");
    expect(snap.plan).toBe("off");
    expect(snap.jobs).toEqual([]);
    expect(snap.subagents.live).toEqual([]);
    expect(snap.subagents.quota.maxDepth).toBeGreaterThanOrEqual(1);
    expect(snap.subagents.quota.maxActive).toBeGreaterThanOrEqual(1);
    expect(snap.subagents.quota.slotsFree).toBe(snap.subagents.quota.maxActive);
    expect(snap.channels.im.length).toBeGreaterThan(0);

    const text = formatSessionStatusText(snap);
    expect(text).toContain("theme: system");
    expect(text).toContain("jobs: 0 total");
    expect(text).toContain("subagents:");
    expect(text).toMatch(/quota depth/);
    expect(text).toContain("cost:");
    expect(text).toContain("billing:");
    expect(text).toContain("timeline:");
    expect(snap.cost.byModel).toEqual({});
    expect(snap.cost.byProviderModel).toEqual({});
    expect(snap.billing.todayCost).toBeTypeOf("number");
    expect(Array.isArray(snap.billing.byModel)).toBe(true);
    expect(text).toContain("channels:");
    expect(snap.timeline.injectSources).toEqual([]);
    expect(snap.timeline.spillCount).toBe(0);
    expect(snap.timeline.pruneCount).toBe(0);
    expect(snap.compaction.pipeline).toBe("none");
    expect(snap.compaction.phase).toBe("idle");
    expect(snap.delivery.turnActive).toBe(false);
    expect(snap.delivery.queueAcceptedWhileBusy).toBe(true);
    expect(snap.teamTasks).toEqual([]);
    expect(text).toContain("team tasks:");
    expect(text).toContain("compaction:");
    expect(text).toContain("delivery:");

    const rpc = await dispatchFaceMethod(runtime, "session.status", "st", {
      sessionId,
    });
    expect(rpc.result.ok).toBe(true);
    if (rpc.result.ok) {
      expect(rpc.result.value).toMatchObject({
        sessionId,
        theme: "system",
        plan: "off",
      });
    }

    const slash = await dispatchFaceMethod(runtime, "commands/execute", "s", {
      args: { agentId: sessionId, line: "/status" },
    });
    expect(slash.result.ok).toBe(true);
    if (slash.result.ok) {
      const body = (slash.result.value as { result: { text: string } }).result
        .text;
      expect(body).toContain("jobs:");
      expect(body).toContain("channels:");
    }
  });

  it("folds prune→summary pipeline and delivery mutex into Status", async () => {
    const store = createMemorySessionStore();
    let turnActive = false;
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
      drain: {
        wake() {},
        async cancel() {},
        isActive() {
          return turnActive;
        },
      },
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c2", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    store.append(sessionId, {
      type: "turn/start",
      ts: 1,
      turnId: "t1",
    });
    store.append(sessionId, {
      type: "tool/result",
      ts: 2,
      turnId: "t1",
      stepId: "s1",
      result: {
        toolCallId: "tc1",
        name: "bash",
        content:
          "Full formatted result stored at: /tmp/spill/s_tc1.txt. Retrieve with read_file.\n\nhead…",
        meta: { xrkPrunePreviousSurfaceTokens: 900 },
      },
    });
    store.append(sessionId, {
      type: "context/compaction",
      ts: 3,
      reason: "auto",
      summary: "## Summary\nok",
      recent: "",
      shadowedTokenCount: 1200,
    });

    const idle = buildSessionStatusSnapshot(runtime, sessionId);
    expect(idle.compaction.pipeline).toBe("prune→summary");
    expect(idle.compaction.stages).toEqual(["prune", "summary"]);
    expect(idle.compaction.lastReason).toBe("auto");
    expect(idle.compaction.lastShadowedTokens).toBe(1200);
    expect(idle.compaction.pruneCount).toBe(1);
    expect(idle.compaction.summaryCount).toBe(1);
    expect(idle.compaction.phase).toBe("idle");
    expect(idle.delivery.compactBlockedByTurn).toBe(false);

    turnActive = true;
    const busy = buildSessionStatusSnapshot(runtime, sessionId);
    expect(busy.compaction.phase).toBe("busy");
    expect(busy.delivery.turnActive).toBe(true);
    expect(busy.delivery.compactBlockedByTurn).toBe(true);
    expect(busy.delivery.queueAcceptedWhileBusy).toBe(true);
    expect(formatSessionStatusText(busy)).toContain("compact↔turn exclusive");
  });
});
