import { describe, expect, it, beforeEach } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import {
  buildSessionStatusSnapshot,
  formatSessionStatusText,
} from "../src/session-status.js";
import { resetStatusSnapshotCacheForTests } from "../src/status-snapshot-cache.js";
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

/** Coding workspace — bare `session.create` lands on Xiangyang (奇创). */
async function createCodingSession(
  runtime: ReturnType<typeof bareRuntime>,
  payload: Record<string, unknown> = {},
  rpcId = "c",
): Promise<string> {
  const coding = runtime.workspaces.create(
    `${runtime.workspaceRoot}/code-${rpcId}`,
  ).workspace;
  const created = await dispatchFaceMethod(runtime, "session.create", rpcId, {
    workspaceId: coding.workspaceId,
    ...payload,
  });
  if (!created.result.ok) throw new Error("create coding session");
  return (created.result.value as { sessionId: string }).sessionId;
}

describe("session status snapshot", () => {
  beforeEach(() => {
    resetStatusSnapshotCacheForTests();
  });

  it("builds shared facts for /status and session.status", async () => {
    const runtime = bareRuntime();
    // Bare create lands on Xiangyang → 奇创 (subagents off → zero slots).
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const snap = buildSessionStatusSnapshot(runtime, sessionId);
    expect(snap.sessionId).toBe(sessionId);
    expect(snap.theme).toBe("system");
    expect(snap.plan).toBe("off");
    expect(snap.jobs).toEqual([]);
    expect(snap.subagents.live).toEqual([]);
    expect(snap.badge).toBe("qichuang");
    expect(snap.subagents.quota.maxDepth).toBe(0);
    expect(snap.subagents.quota.maxActive).toBe(0);
    expect(snap.subagents.quota.slotsFree).toBe(0);
    expect(snap.channels.im.length).toBeGreaterThan(0);

    const text = formatSessionStatusText(snap);
    expect(text).toContain("theme: system");
    expect(text).toContain("jobs: 0 total");
    expect(text).toContain("subagents:");
    expect(text).toMatch(/quota .+\/.+ sessions /);
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

  it("reports positive per-model session caps for harness badges", async () => {
    const runtime = bareRuntime();
    const sessionId = await createCodingSession(runtime, {
      agentPreset: "harness",
    });
    const snap = buildSessionStatusSnapshot(runtime, sessionId);
    expect(snap.badge).toBe("harness");
    expect(snap.subagents.quota.maxDepth).toBe(0);
    expect(snap.subagents.quota.maxActive).toBeGreaterThanOrEqual(1);
    expect(snap.subagents.quota.slotsFree).toBe(
      Math.max(0, snap.subagents.quota.maxActive - snap.subagents.quota.active),
    );
  });

  it("flags fleet:slots warn when the model session route is full", async () => {
    // Cap counts drain-active sessions only. A quiet blank does not fill the
    // route; mark the session active so Status shows slots_free=0 (warn).
    const store = createMemorySessionStore();
    const active = new Set<string>();
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: admittingAgentResolve(store),
      defaultAgentPreset: "shallow",
      drain: {
        ...idleFaceDrain,
        isActive: (sessionId: string) => active.has(sessionId),
      },
    });

    const cap = await dispatchFaceMethod(runtime, "settings.mutate", "cap", {
      ns: "agent-loop",
      ops: [
        {
          op: "set",
          path: ["maxConcurrentModelSessions"],
          value: 1,
        },
      ],
    });
    expect(cap.result.ok).toBe(true);

    const sessionId = await createCodingSession(
      runtime,
      { agentPreset: "shallow" },
      "cap",
    );
    runtime.sessionModels.set(sessionId, {
      provider: "deepseek",
      model: "deepseek-flash",
    });
    active.add(sessionId);

    const snap = buildSessionStatusSnapshot(runtime, sessionId);
    expect(snap.subagents.quota.maxDepth).toBe(0);
    expect(snap.subagents.quota.maxActive).toBe(1);
    expect(snap.subagents.quota.active).toBe(1);
    expect(snap.subagents.quota.slotsFree).toBe(0);
    expect(snap.fleet.alerts.find((a) => a.id === "fleet:slots")?.severity).toBe(
      "warn",
    );
    expect(snap.fleet.health).toBe("warn");
    expect(snap.fleet.alerts.find((a) => a.id === "fleet:depth")).toBeUndefined();
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
    expect(byId.get(layer1)?.activity).toBe("inactive");
    expect(snap.subagents.graph.nodes.find((n) => n.id === layer2)?.activity).toBe(
      "running",
    );
    expect(snap.subagents.graph.nodes.find((n) => n.id === root)?.activity).toBe(
      "inactive",
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
    Object.assign(runtime.settingsNamespaces.ensure("locale").user, {
      preference: "zh",
    });
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
    const parentSnap = buildSessionStatusSnapshot(runtime, parent);
    // Project sessions always show Boss → 经理 office pair.
    expect(parentSnap.delegate?.parentSessionId).toBe(parent);
    expect(parentSnap.parentCompanionBall).toBeDefined();
    expect(parentSnap.companionBall).toBeDefined();
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
    const untitledDelegate = buildSessionStatusSnapshot(runtime, untitled).delegate;
    expect(untitledDelegate).toMatchObject({
      parentSessionId: parent,
      childLabel: "untitled",
      parentMemberId: "mem_seed_xrkseek",
      childSeat: "agent",
    });
    expect(untitledDelegate?.parentLabel).toContain("向日葵");
    expect(untitledDelegate?.parents?.[0]).toMatchObject({
      sessionId: parent,
      memberId: "mem_seed_xrkseek",
      kind: "opener",
    });
    expect(untitledDelegate?.parents?.[0]?.label).toContain("向日葵");
    // Xiangyang-spawned child: left seat is 向日葵（xrkseek）, not 老板.
    expect(buildSessionStatusSnapshot(runtime, untitled).parentCompanionBall).toEqual(
      parentSnap.companionBall,
    );
    runtime.presence.set(parent, {
      emotionId: "31",
      tips: "发版员已接手，我这边只读盘点",
    });
    expect(buildSessionStatusSnapshot(runtime, kitted).parentPresence).toMatchObject({
      emotionId: "31",
      tips: "发版员已接手，我这边只读盘点",
      source: "tool",
    });
    // Office root: left seat is operator mood from ui-presence (not AI presence_set).
    expect(buildSessionStatusSnapshot(runtime, parent).parentPresence).toMatchObject({
      emotionId: "16",
      source: "tool",
    });
    // Bare create lands on Xiangyang → Boss → 经理 · 向日葵（xrkseek）.
    expect(parentSnap.delegate).toEqual({
      parentSessionId: parent,
      childLabel: "向日葵（xrkseek）",
      childSeat: "manager",
      childMemberId: "mem_seed_xrkseek",
    });
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
    Object.assign(runtime.settingsNamespaces.ensure("locale").user, {
      preference: "zh",
    });
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
    // Mid's parent is Xiangyang → left seat is 向日葵（xrkseek）.
    expect(midSnap.parentCompanionBall).toEqual(
      buildSessionStatusSnapshot(runtime, home).companionBall,
    );
    expect(midSnap.companionBall).toEqual({ shape: "wedge", color: "sage" });
    expect(midSnap.delegate).toMatchObject({
      parentSessionId: home,
      childLabel: "发版员",
      parentMemberId: "mem_seed_xrkseek",
      childSeat: "agent",
    });
    expect(midSnap.delegate?.parentLabel).toContain("向日葵");
    expect(midSnap.delegate?.parents?.[0]).toMatchObject({
      sessionId: home,
      memberId: "mem_seed_xrkseek",
      kind: "opener",
    });
    const leafSnap = buildSessionStatusSnapshot(runtime, leaf);
    expect(leafSnap.parentCompanionBall).toEqual({ shape: "wedge", color: "sage" });
    expect(leafSnap.companionBall).toEqual({
      shape: "squircle",
      color: "sky",
      kit: "cap",
      kitHat: "cap",
    });
    expect(leafSnap.delegate).toMatchObject({
      parentSessionId: mid,
      childLabel: "调研员",
      childSeat: "agent",
      childMemberId: "mem_seed_researcher",
    });
    expect(leafSnap.delegate?.parentLabel).toContain("发版员");
    expect(leafSnap.delegate?.parents?.map((p) => p.sessionId)).toEqual([
      home,
      mid,
    ]);
    expect(leafSnap.delegate?.parents?.[0]).toMatchObject({
      sessionId: home,
      kind: "ancestor",
    });
    expect(leafSnap.delegate?.parents?.[1]).toMatchObject({
      sessionId: mid,
      kind: "opener",
      look: { shape: "wedge", color: "sage" },
    });
    expect(formatSessionStatusText(leafSnap)).toMatch(/delegate: .*发版员.* → 调研员/);
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
    // Parent stays idle while only a sibling drains.
    expect(activityOf(root)).toBe("inactive");
    expect(activityOf(first)).toBe("inactive");
    expect(activityOf(third)).toBe("inactive");
    expect(snap.parentDelivery).toEqual({
      turnActive: false,
      queued: 0,
      steering: 0,
      runningSubs: 1,
    });
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

  it("office session opened from 向日葵 paints 向日葵 as 委派方; boss stacks after human spoke", async () => {
    const runtime = bareRuntime();
    Object.assign(runtime.settingsNamespaces.ensure("locale").user, {
      preference: "zh",
    });
    const xy = await dispatchFaceMethod(runtime, "session.create", "xy", {});
    if (!xy.result.ok) throw new Error("create xy");
    const xyId = (xy.result.value as { sessionId: string }).sessionId;
    const codingId = await createCodingSession(runtime, {
      inheritFrom: xyId,
    }, "code-from-xy");

    expect(runtime.sessionOpeners.get(codingId)).toEqual({
      memberId: "mem_seed_xrkseek",
      sourceSessionId: xyId,
    });
    const opened = buildSessionStatusSnapshot(runtime, codingId);
    expect(opened.delegate?.parentMemberId).toBe("mem_seed_xrkseek");
    // Real source session id — two managers stay distinguishable by sessionId.
    expect(opened.delegate?.parentSessionId).toBe(xyId);
    expect(opened.delegate?.parents).toHaveLength(1);
    expect(opened.delegate?.parents?.[0]).toMatchObject({
      sessionId: xyId,
      memberId: "mem_seed_xrkseek",
      kind: "opener",
    });
    expect(opened.delegate?.parents?.[0]?.label).toContain("向日葵");
    expect(opened.delegate?.parents?.[0]?.label).toContain(xyId.slice(-8));
    expect(opened.delegate?.parents?.[0]?.look?.shape).toBeTruthy();
    // Opener-led seat syncs the source session ball — not Settings boss mood.
    runtime.presence.set(xyId, {
      emotionId: "31",
      tips: "向日葵支线巡演",
    });
    const synced = buildSessionStatusSnapshot(runtime, codingId);
    expect(synced.parentPresence).toMatchObject({
      emotionId: "31",
      tips: "向日葵支线巡演",
      source: "tool",
    });
    expect(synced.delegate?.parents?.[0]?.presence).toMatchObject({
      emotionId: "31",
      tips: "向日葵支线巡演",
    });

    runtime.sessionHumanSpoke.add(codingId);
    const afterBoss = buildSessionStatusSnapshot(runtime, codingId);
    // Boss is lead (last) — recent human bubble owns the full-size 委派方 seat.
    expect(afterBoss.delegate?.parents?.at(-1)).toMatchObject({
      sessionId: `${codingId}:boss`,
      label: "老板",
      kind: "boss",
    });
    expect(afterBoss.delegate?.parents?.[0]?.sessionId).toBe(xyId);
    expect(afterBoss.delegate?.parents?.[0]?.memberId).toBe("mem_seed_xrkseek");
  });

  it("manager A → manager B (same roster member) still paints A as B's opener 委派方", async () => {
    const runtime = bareRuntime();
    Object.assign(runtime.settingsNamespaces.ensure("locale").user, {
      preference: "zh",
    });
    const a = await createCodingSession(runtime, {}, "paint-a");
    const b = await createCodingSession(runtime, { inheritFrom: a }, "paint-b");
    expect(runtime.sessionOpeners.get(b)?.sourceSessionId).toBe(a);

    const snapB = buildSessionStatusSnapshot(runtime, b);
    // Same MANAGER_MEMBER_ID on both seats must not drop opener.
    expect(snapB.delegate?.parentSessionId).toBe(a);
    expect(snapB.delegate?.parents?.[0]).toMatchObject({
      sessionId: a,
      kind: "opener",
    });
    expect(snapB.delegate?.childSeat).toBe("manager");

    // B reports back → A gains B as peer 委派方 (left stack); right ball stays A.
    runtime.agentTeams.linkPeers(a, b, "collab");
    const snapA = buildSessionStatusSnapshot(runtime, a);
    expect(snapA.delegate?.parents?.some((p) => p.sessionId === b && p.kind === "peer")).toBe(
      true,
    );

    // Boss speaks in B → 老板 becomes lead; A peeks behind.
    runtime.sessionHumanSpoke.add(b);
    const snapBBoss = buildSessionStatusSnapshot(runtime, b);
    expect(snapBBoss.delegate?.parents?.map((p) => p.kind)).toEqual([
      "opener",
      "boss",
    ]);
    expect(snapBBoss.delegate?.parents?.[0]?.sessionId).toBe(a);
    expect(snapBBoss.delegate?.parents?.at(-1)?.sessionId).toBe(`${b}:boss`);
  });

  it("collab peers paint mutual 委派方; boss stacks when human spoke", async () => {
    const runtime = bareRuntime();
    Object.assign(runtime.settingsNamespaces.ensure("locale").user, {
      preference: "zh",
    });
    const a = await createCodingSession(runtime, {}, "collab-a");
    const b = await createCodingSession(runtime, {}, "collab-b");
    runtime.agentTeams.linkPeers(a, b, "collab");

    const snapA = buildSessionStatusSnapshot(runtime, a);
    const snapB = buildSessionStatusSnapshot(runtime, b);
    expect(snapA.delegate?.parentSessionId).toBe(b);
    expect(snapB.delegate?.parentSessionId).toBe(a);
    expect(snapA.delegate?.parents?.[0]?.kind).toBe("peer");
    expect(snapA.delegate?.parents?.[0]?.sessionId).toBe(b);
    expect(snapB.delegate?.parents?.[0]?.sessionId).toBe(a);

    runtime.sessionHumanSpoke.add(a);
    const afterBoss = buildSessionStatusSnapshot(runtime, a);
    expect(afterBoss.delegate?.parents?.map((p) => p.kind)).toEqual([
      "peer",
      "boss",
    ]);
    expect(afterBoss.delegate?.parents?.at(-1)?.sessionId).toBe(`${a}:boss`);
    // Lead is synthetic `:boss` → office seat id (not the peer) for Overview mux.
    expect(afterBoss.delegate?.parentSessionId).toBe(a);
  });

  it("pins 委派方 lead to the most recent bubble speaker", async () => {
    const runtime = bareRuntime();
    Object.assign(runtime.settingsNamespaces.ensure("locale").user, {
      preference: "zh",
    });
    const home = await createCodingSession(runtime, {}, "bubble-home");
    const peer = await createCodingSession(runtime, {}, "bubble-peer");
    runtime.agentTeams.linkPeers(home, peer, "collab");
    const store = runtime.store;

    // Durable bubbles (promote path): peer → boss → peer. Lead follows the
    // latest speaker so Overview feels like「最近和谁聊就置顶谁」.
    store.append(home, {
      type: "user/message",
      ts: 1,
      turnId: "bp1",
      content: "peer first",
      source: {
        kind: "seat",
        form: "speech",
        channel: "peer",
        fromSessionId: peer,
      },
    });
    const afterPeer = buildSessionStatusSnapshot(runtime, home);
    expect(afterPeer.delegate?.parents?.at(-1)?.sessionId).toBe(peer);

    store.append(home, {
      type: "user/message",
      ts: 2,
      turnId: "bp2",
      content: "boss next",
      source: { kind: "user" },
    });
    const afterBoss = buildSessionStatusSnapshot(runtime, home);
    expect(afterBoss.delegate?.parents?.map((p) => p.sessionId)).toEqual([
      peer,
      `${home}:boss`,
    ]);
    expect(afterBoss.delegate?.parentSessionId).toBe(home);

    store.append(home, {
      type: "user/message",
      ts: 3,
      turnId: "bp3",
      content: "peer again",
      source: {
        kind: "seat",
        form: "speech",
        channel: "peer",
        fromSessionId: peer,
      },
    });
    const afterPeerAgain = buildSessionStatusSnapshot(runtime, home);
    expect(afterPeerAgain.delegate?.parents?.at(-1)?.sessionId).toBe(peer);
    expect(afterPeerAgain.delegate?.parents?.[0]?.sessionId).toBe(`${home}:boss`);
  });

  it("session.prompt seatChannel peer arms collab edge for Overview", async () => {
    const runtime = bareRuntime();
    Object.assign(runtime.settingsNamespaces.ensure("locale").user, {
      preference: "zh",
    });
    const a = await createCodingSession(runtime, {}, "peer-prompt-a");
    const b = await createCodingSession(runtime, {}, "peer-prompt-b");

    const prompt = await dispatchFaceMethod(runtime, "session.prompt", "pp", {
      sessionId: b,
      mode: "queue",
      seatChannel: "peer",
      fromSessionId: a,
      content: [{ type: "text", text: "peer hello" }],
    });
    expect(prompt.result).toEqual({ ok: true, value: { accepted: true } });

    const hops = runtime.agentTeams.neighbors(b, "peer");
    expect(hops.some((h) => h.id === a && h.label === "collab")).toBe(true);

    const snapA = buildSessionStatusSnapshot(runtime, a);
    const snapB = buildSessionStatusSnapshot(runtime, b);
    expect(snapA.delegate?.parents?.[0]).toMatchObject({
      sessionId: b,
      kind: "peer",
    });
    expect(snapB.delegate?.parents?.[0]).toMatchObject({
      sessionId: a,
      kind: "peer",
    });
  });

  it("session.prompt peer does not collab-link a true parent↔child pair", async () => {
    const runtime = bareRuntime();
    const parent = await createCodingSession(runtime, {}, "peer-skip-parent");
    const child = await createCodingSession(runtime, {}, "peer-skip-child");
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: child,
      mode: "continuable",
      label: "调研员",
    });

    const prompt = await dispatchFaceMethod(runtime, "session.prompt", "ps", {
      sessionId: child,
      mode: "queue",
      seatChannel: "peer",
      fromSessionId: parent,
      content: [{ type: "text", text: "should stay delegation" }],
    });
    expect(prompt.result).toEqual({ ok: true, value: { accepted: true } });

    const hops = runtime.agentTeams.neighbors(child, "peer");
    expect(hops.some((h) => h.id === parent && h.label === "collab")).toBe(
      false,
    );

    const snap = buildSessionStatusSnapshot(runtime, child);
    expect(snap.delegate?.parentSessionId).toBe(parent);
    expect(snap.delegate?.parents?.some((p) => p.kind === "peer")).toBe(false);
  });

  it("readSessionOpener purges corrupt legacy map values", async () => {
    const runtime = bareRuntime();
    const id = await createCodingSession(runtime, {}, "opener-corrupt");
    // Legacy runtimes stored a bare memberId string.
    (runtime.sessionOpeners as Map<string, unknown>).set(
      id,
      "mem_seed_manager",
    );
    const { readSessionOpener } = await import("../src/session-opener.js");
    expect(readSessionOpener(runtime, id)).toBeUndefined();
    expect(runtime.sessionOpeners.has(id)).toBe(false);
  });

  it("walks nested subagent parents (N>2) with per-layer look; caps at 4 with boss", async () => {
    const runtime = bareRuntime();
    Object.assign(runtime.settingsNamespaces.ensure("locale").user, {
      preference: "zh",
    });
    const create = async (requestId: string): Promise<string> => {
      const created = await dispatchFaceMethod(runtime, "session.create", requestId, {});
      if (!created.result.ok) throw new Error("create");
      return (created.result.value as { sessionId: string }).sessionId;
    };
    const root = await create("nest-root");
    const midA = await create("nest-mid-a");
    const midB = await create("nest-mid-b");
    const leaf = await create("nest-leaf");
    runtime.subagents.attach({
      parentSessionId: root,
      childSessionId: midA,
      mode: "continuable",
      label: "发版员",
      appearance: { shape: "wedge", color: "sage", kit: "bow" },
    });
    runtime.subagents.attach({
      parentSessionId: midA,
      childSessionId: midB,
      mode: "continuable",
      label: "协调员",
      appearance: { shape: "pill", color: "rose" },
    });
    runtime.subagents.attach({
      parentSessionId: midB,
      childSessionId: leaf,
      mode: "continuable",
      label: "调研员",
      appearance: { shape: "squircle", color: "sky" },
    });

    const snap = buildSessionStatusSnapshot(runtime, leaf);
    expect(snap.delegate?.parents?.map((p) => p.sessionId)).toEqual([
      root,
      midA,
      midB,
    ]);
    expect(snap.delegate?.parents?.[1]?.label).toContain("发版员");
    expect(snap.delegate?.parents?.[1]?.look).toMatchObject({
      shape: "wedge",
      color: "sage",
    });
    expect(snap.delegate?.parents?.[2]?.label).toContain("协调员");
    expect(snap.delegate?.parents?.[2]?.look).toMatchObject({
      shape: "pill",
      color: "rose",
    });
    expect(snap.delegate?.parentSessionId).toBe(midB);

    runtime.sessionHumanSpoke.add(leaf);
    const withBoss = buildSessionStatusSnapshot(runtime, leaf);
    // 3 AI + :boss lead = 4; boss is last (full-size 委派方).
    expect(withBoss.delegate?.parents?.length).toBe(4);
    expect(withBoss.delegate?.parents?.at(-1)?.sessionId).toBe(`${leaf}:boss`);
    expect(withBoss.delegate?.parents?.[0]?.sessionId).toBe(root);
    expect(withBoss.delegate?.parents?.map((p) => p.sessionId)).toEqual([
      root,
      midA,
      midB,
      `${leaf}:boss`,
    ]);
  });
});
