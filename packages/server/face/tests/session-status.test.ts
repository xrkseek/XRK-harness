import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import {
  buildSessionStatusSnapshot,
  formatSessionStatusText,
} from "../src/session-status.js";
import { formatPermissionStatusLabel } from "../src/permissions.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  admittingAgentResolve,
  createBareFaceRuntime,
  idleFaceDrain,
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
    // Bare create pins the settings/CLI default (minimal) — subagents off → zero caps.
    expect(snap.badge).toBe("minimal");
    expect(snap.subagents.quota.maxDepth).toBe(0);
    expect(snap.subagents.quota.maxActive).toBe(0);
    expect(snap.subagents.quota.slotsFree).toBe(0);
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
    expect(Array.isArray(snap.billing.dailyTrend)).toBe(true);
    expect(snap.fleet.health).toMatch(/^(ok|warn|critical)$/);
    expect(Array.isArray(snap.fleet.alerts)).toBe(true);
    expect(Array.isArray(snap.channels.alerts)).toBe(true);
    expect(text).toContain("fleet:");
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

  it("reports positive subagent caps for harness badges", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {
      agentPreset: "harness",
    });
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const snap = buildSessionStatusSnapshot(runtime, sessionId);
    expect(snap.badge).toBe("harness");
    expect(snap.subagents.quota.maxDepth).toBeGreaterThanOrEqual(1);
    expect(snap.subagents.quota.maxActive).toBeGreaterThanOrEqual(1);
    expect(snap.subagents.quota.slotsFree).toBe(snap.subagents.quota.maxActive);
  });

  it("keeps depth-at-cap at warn when no child is live or queued", async () => {
    // Depth-at-cap is a lineage fact that outlives the child. A session that
    // already reached its badge cap must not stay "critical" once nothing is
    // running: the operator glance would read an idle session as a fault.
    const store = createMemorySessionStore();
    let turnActive = false;
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
      defaultAgentPreset: "shallow",
      drain: {
        ...idleFaceDrain,
        isActive: () => turnActive,
      },
    });

    // `depth` is the subject session's own lineage level (root 0, child 1),
    // so the cap-scoped session here is the child: Shallow maxDepth 1.
    const parent = runtime.ensureSession("depth-parent");
    runtime.sessionAgentPresets.set(parent, "shallow");
    const child = runtime.ensureSession("depth-child");
    runtime.sessionAgentPresets.set(child, "shallow");
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: child,
      mode: "continuable",
      label: "c",
    });

    // Lineage sits at the cap, but nothing is running → warn, not critical.
    turnActive = false;
    const idle = buildSessionStatusSnapshot(runtime, child);
    expect(idle.subagents.quota.depth).toBe(1);
    expect(idle.subagents.quota.maxDepth).toBe(1);
    expect(idle.fleet.alerts.find((a) => a.id === "fleet:depth")?.severity).toBe("warn");
    expect(idle.fleet.health).not.toBe("critical");

    // Same lineage, now actually working → real pressure → critical.
    turnActive = true;
    const busy = buildSessionStatusSnapshot(runtime, child);
    expect(busy.fleet.alerts.find((a) => a.id === "fleet:depth")?.severity).toBe("critical");
    expect(busy.fleet.health).toBe("critical");

    // Pressure gone again → falls back to warn.
    turnActive = false;
    expect(
      buildSessionStatusSnapshot(runtime, child).fleet.alerts.find((a) => a.id === "fleet:depth")
        ?.severity,
    ).toBe("warn");
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

  it("session.cancel idles delivery.turnActive while drain join still holds compact", async () => {
    const store = createMemorySessionStore();
    let latch = true;
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
      drain: {
        wake() {},
        async cancel() {},
        isActive() {
          return latch;
        },
      },
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c-idle", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const busy = buildSessionStatusSnapshot(runtime, sessionId);
    expect(busy.delivery.turnActive).toBe(true);
    expect(busy.delivery.compactBlockedByTurn).toBe(true);

    const cancel = await dispatchFaceMethod(runtime, "session.cancel", "x-idle", {
      sessionId,
    });
    expect(cancel.result).toEqual({ ok: true, value: { accepted: true } });

    const settling = buildSessionStatusSnapshot(runtime, sessionId);
    expect(settling.delivery.turnActive).toBe(false);
    expect(settling.delivery.compactBlockedByTurn).toBe(true);
    expect(settling.compaction.phase).toBe("idle");
    expect(settling.delivery.note).toContain("drain settling");

    latch = false;
    runtime.onSessionDrainStatus(sessionId, false);
    const idle = buildSessionStatusSnapshot(runtime, sessionId);
    expect(idle.delivery.turnActive).toBe(false);
    expect(idle.delivery.compactBlockedByTurn).toBe(false);
    expect(idle.compaction.phase).toBe("idle");
  });

  it("keeps a two-level delegation live while only the grandchild drains", async () => {
    const store = createMemorySessionStore();
    const draining = new Set<string>();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
      drain: {
        wake() {},
        async cancel() {},
        isActive: (sessionId: string) => draining.has(sessionId),
      },
    });
    const create = async (requestId: string): Promise<string> => {
      const created = await dispatchFaceMethod(
        runtime,
        "session.create",
        requestId,
        {},
      );
      if (!created.result.ok) throw new Error("create");
      return (created.result.value as { sessionId: string }).sessionId;
    };
    const root = await create("c3");
    const layer1 = await create("c4");
    const layer2 = await create("c5");
    runtime.subagents.attach({
      parentSessionId: root,
      childSessionId: layer1,
      mode: "continuable",
      label: "layer 1",
    });
    runtime.subagents.attach({
      parentSessionId: layer1,
      childSessionId: layer2,
      mode: "continuable",
      label: "layer 2",
    });
    store.append(layer2, { type: "turn/start", ts: 1, turnId: "t2" });
    // layer1 already parked after handing the task down; only layer2 runs.
    draining.add(layer2);

    const snap = buildSessionStatusSnapshot(runtime, root);
    const byId = new Map(snap.subagents.live.map((s) => [s.id, s]));
    expect([...byId.keys()].sort()).toEqual([layer1, layer2].sort());
    expect(byId.get(layer2)?.activity).toBe("running");
    expect(byId.get(layer1)?.activity).toBe("running");
    expect(snap.subagents.graph.nodes.find((n) => n.id === layer2)?.activity).toBe(
      "running",
    );

    draining.clear();
    const settled = buildSessionStatusSnapshot(runtime, root);
    expect(settled.subagents.live.every((s) => s.activity === "inactive")).toBe(true);
  });

  it("gives untitled children a default companion ball so Settings kit does not leak", async () => {
    const runtime = bareRuntime();
    const create = async (requestId: string): Promise<string> => {
      const created = await dispatchFaceMethod(runtime, "session.create", requestId, {});
      if (!created.result.ok) throw new Error("create");
      return (created.result.value as { sessionId: string }).sessionId;
    };
    const parent = await create("c-home");
    const untitled = await create("c-untitled");
    const kitted = await create("c-kitted");
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: untitled,
      mode: "continuable",
      label: "untitled",
    });
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: kitted,
      mode: "continuable",
      label: "发版员",
      appearance: { shape: "wedge", color: "sage", kit: "bow" },
    });
    expect(buildSessionStatusSnapshot(runtime, parent).companionBall).toBeUndefined();
    expect(buildSessionStatusSnapshot(runtime, untitled).companionBall).toEqual({
      shape: "blob",
      color: "cream",
    });
    expect(buildSessionStatusSnapshot(runtime, kitted).companionBall).toEqual({
      shape: "wedge",
      color: "sage",
      kit: "bow",
      kitHat: "bow",
    });
    expect(buildSessionStatusSnapshot(runtime, untitled).delegate).toEqual({
      parentSessionId: parent,
      childLabel: "untitled",
    });
    expect(buildSessionStatusSnapshot(runtime, untitled).parentCompanionBall).toBeUndefined();
    runtime.presence.set(parent, {
      emotionId: "31",
      tips: "发版员已接手，我这边只读盘点",
    });
    expect(buildSessionStatusSnapshot(runtime, kitted).parentPresence).toMatchObject({
      emotionId: "31",
      tips: "发版员已接手，我这边只读盘点",
      source: "tool",
    });
    expect(buildSessionStatusSnapshot(runtime, parent).parentPresence).toBeUndefined();
  });

  it("gives nested children dual balls: immediate parent look + own look", async () => {
    const runtime = bareRuntime();
    const create = async (requestId: string): Promise<string> => {
      const created = await dispatchFaceMethod(runtime, "session.create", requestId, {});
      if (!created.result.ok) throw new Error("create");
      return (created.result.value as { sessionId: string }).sessionId;
    };
    const home = await create("c-home");
    const mid = await create("c-mid");
    const leaf = await create("c-leaf");
    runtime.subagents.attach({
      parentSessionId: home,
      childSessionId: mid,
      mode: "continuable",
      label: "发版员",
      appearance: { shape: "wedge", color: "sage" },
    });
    runtime.subagents.attach({
      parentSessionId: mid,
      childSessionId: leaf,
      mode: "continuable",
      label: "调研员",
      appearance: { shape: "squircle", color: "sky", kit: "cap" },
    });
    const midSnap = buildSessionStatusSnapshot(runtime, mid);
    expect(midSnap.parentCompanionBall).toBeUndefined();
    expect(midSnap.companionBall).toEqual({ shape: "wedge", color: "sage" });
    expect(midSnap.delegate).toEqual({ parentSessionId: home, childLabel: "发版员" });
    const leafSnap = buildSessionStatusSnapshot(runtime, leaf);
    expect(leafSnap.parentCompanionBall).toEqual({ shape: "wedge", color: "sage" });
    expect(leafSnap.companionBall).toEqual({
      shape: "squircle",
      color: "sky",
      kit: "cap",
      kitHat: "cap",
    });
    expect(leafSnap.delegate).toEqual({
      parentSessionId: mid,
      childLabel: "调研员",
      parentLabel: "发版员",
    });
    expect(formatSessionStatusText(leafSnap)).toContain("delegate: 发版员 → 调研员");
  });

  it("attaches last-turn outcome so a parent abort is not a finished child", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
    });
    const create = async (requestId: string): Promise<string> => {
      const created = await dispatchFaceMethod(
        runtime,
        "session.create",
        requestId,
        {},
      );
      if (!created.result.ok) throw new Error("create");
      return (created.result.value as { sessionId: string }).sessionId;
    };
    const root = await create("c-out-p");
    const child = await create("c-out-c");
    runtime.subagents.attach({
      parentSessionId: root,
      childSessionId: child,
      mode: "one-shot",
      label: "cut off",
    });
    store.append(child, { type: "turn/start", ts: 1, turnId: "t-cut" });
    store.append(child, {
      type: "turn/end",
      ts: 2,
      turnId: "t-cut",
      reason: { kind: "aborted", reason: { kind: "parent" } },
    });

    const snap = buildSessionStatusSnapshot(runtime, root);
    expect(snap.subagents.live[0]?.activity).toBe("inactive");
    expect(snap.subagents.live[0]?.outcome).toMatchObject({
      kind: "aborted",
      cause: "parent",
    });
    expect(formatSessionStatusText(snap)).toContain("aborted by parent");
  });

  it("keeps graph-only delegation nodes live when the registry lost the link", async () => {
    const store = createMemorySessionStore();
    const draining = new Set<string>();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
      drain: {
        wake() {},
        async cancel() {},
        isActive: (sessionId: string) => draining.has(sessionId),
      },
    });
    const create = async (requestId: string): Promise<string> => {
      const created = await dispatchFaceMethod(
        runtime,
        "session.create",
        requestId,
        {},
      );
      if (!created.result.ok) throw new Error("create");
      return (created.result.value as { sessionId: string }).sessionId;
    };
    const root = await create("c6");
    const child = await create("c7");
    // Durable team graph survived, the in-memory registry link did not.
    runtime.agentTeams.recordDelegation({
      parentSessionId: root,
      childSessionId: child,
      mode: "one-shot",
      label: "one-shot task",
    });
    store.append(child, { type: "turn/start", ts: 1, turnId: "t3" });
    draining.add(child);

    const snap = buildSessionStatusSnapshot(runtime, root);
    expect(snap.subagents.graph.nodes.find((n) => n.id === child)?.activity).toBe(
      "running",
    );
    expect(snap.subagents.live.map((s) => s.id)).toContain(child);
    expect(snap.subagents.live[0]?.mode).toBe("delegated");
    expect(snap.subagents.live[0]?.label).toBe("one-shot task");

    // The session's own node reads its turn — a running turn must not render
    // as the "no activity → done" fallback clients apply to the root node.
    draining.clear();
    draining.add(root);
    const own = buildSessionStatusSnapshot(runtime, root);
    expect(own.subagents.graph.nodes.find((n) => n.id === root)?.activity).toBe(
      "running",
    );

    draining.clear();
    const idle = buildSessionStatusSnapshot(runtime, root);
    for (const id of [root, child]) {
      expect(idle.subagents.graph.nodes.find((n) => n.id === id)?.activity).toBe(
        "inactive",
      );
    }
  });

  it("reports the whole tree when the board is opened on a child", async () => {
    const store = createMemorySessionStore();
    const draining = new Set<string>();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
      drain: {
        wake() {},
        async cancel() {},
        isActive: (sessionId: string) => draining.has(sessionId),
      },
    });
    const create = async (requestId: string): Promise<string> => {
      const created = await dispatchFaceMethod(
        runtime,
        "session.create",
        requestId,
        {},
      );
      if (!created.result.ok) throw new Error("create");
      return (created.result.value as { sessionId: string }).sessionId;
    };
    const root = await create("c8");
    const first = await create("c9");
    const second = await create("c10");
    const third = await create("c11");
    for (const [index, child] of [first, second, third].entries()) {
      runtime.agentTeams.recordDelegation({
        parentSessionId: root,
        childSessionId: child,
        mode: "one-shot",
        label: `one-shot ${index}`,
      });
    }
    // One-shot preview: the board is showing the tree from `first`, which has
    // no delegated children of its own.
    draining.add(second);

    const snap = buildSessionStatusSnapshot(runtime, first);
    // `live` stays this session's own descendants — none here.
    expect(snap.subagents.live).toEqual([]);
    const activityOf = (id: string): string | undefined =>
      snap.subagents.graph.nodes.find((n) => n.id === id)?.activity;
    expect(activityOf(second)).toBe("running");
    // The parent reads running through the sibling that is still draining.
    expect(activityOf(root)).toBe("running");
    expect(activityOf(first)).toBe("inactive");
    expect(activityOf(third)).toBe("inactive");
  });

  it("formats Auto permission as Auto review / Approve for me", () => {
    // Codex status chrome: reviewer label "Approve for me"; DSH product "Auto review".
    expect(formatPermissionStatusLabel("auto")).toBe(
      "Auto review (Approve for me) · no sandbox · per-call review",
    );
    expect(formatPermissionStatusLabel("workspace-write")).toBe(
      "workspace-write",
    );
  });
});
