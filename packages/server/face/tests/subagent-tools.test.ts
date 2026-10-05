import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemorySessionStore, readSessionEvents } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { createFaceRuntime } from "../src/runtime.js";
import {
  bindSubagentTools,
  childOwnedEvents,
  childResumeHint,
  subagentDepth,
} from "../src/subagent-tools.js";
import {
  formatChildOutcome,
  lastAssistantBodyText,
  lastModelRetryNotice,
} from "../src/adapt/subagent-notice.js";
import { FaceSubagentRegistry } from "../src/subagent-registry.js";
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

describe("subagent tools", () => {
  it("tracks lineage depth and registers control tools", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      productDir: mkdtempSync(path.join(tmpdir(), "xrk-sa-depth-")),
      drain: drain(),
      resolveAgent: async () => stubAgent(),
      defaultAgentPreset: "harness",
    });
    const parent = runtime.ensureSession("parent");
    runtime.sessionAgentPresets.set(parent, "harness");
    const child = runtime.ensureSession("child");
    runtime.sessionAgentPresets.set(child, "harness");
    const grand = runtime.ensureSession("grand");
    runtime.sessionAgentPresets.set(grand, "harness");
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: child,
      mode: "continuable",
      label: "c",
    });
    runtime.subagents.attach({
      parentSessionId: child,
      childSessionId: grand,
      mode: "one-shot",
      label: "g",
    });
    expect(subagentDepth(runtime, parent)).toBe(0);
    expect(subagentDepth(runtime, child)).toBe(1);
    expect(subagentDepth(runtime, grand)).toBe(2);

    // UI/rewind fork lineage must not consume tool depth budget.
    const forked = runtime.ensureSession("forked");
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: forked,
      mode: "fork",
      label: "rewind",
    });
    expect(subagentDepth(runtime, forked)).toBe(0);
    expect(runtime.subagents.listDelegated(parent).map((l) => l.childSessionId)).toEqual([
      child,
    ]);

    const tools = createToolRegistry();
    bindSubagentTools(tools, { runtime, parentSessionId: parent });
    expect(tools.get("subagent")).toBeTruthy();
    expect(tools.get("list_agents")).toBeTruthy();
    expect(tools.get("send_message")).toBeTruthy();
    expect(tools.get("team_graph")).toBeTruthy();
    expect(tools.get("followup_task")).toBeTruthy();
    expect(tools.get("wait_agent")).toBeTruthy();
    expect(tools.get("analytics")).toBeTruthy();
    expect(tools.get("interrupt_agent")).toBeTruthy();
    expect(tools.get("ralph")).toBeTruthy();

    const analytics = await tools.get("analytics")!.execute({});
    expect(analytics.content).toMatch(/depth: 0\//);
    expect(analytics.content).toMatch(/active: 0\//);
    expect(analytics.content).toContain(child);

    const listOut = await tools.get("list_agents")!.execute({});
    expect(listOut.content).toMatch(/quota depth/);
    expect(listOut.content).toContain(child);

    const linked = await tools.get("team_graph")!.execute({
      action: "link",
      from: parent,
      to: child,
      label: "pair",
    });
    expect(linked.isError).not.toBe(true);
    const viewed = await tools.get("team_graph")!.execute({ action: "view" });
    expect(viewed.content).toMatch(/team graph/);
    expect(viewed.content).toContain(child);
    expect(viewed.content).toMatch(/d=1/);
    const neighbors = await tools.get("team_graph")!.execute({
      action: "neighbors",
      node_id: parent,
      kind: "peer",
    });
    expect(neighbors.content).toContain(child);

    const waitBad = await tools.get("wait_agent")!.execute({
      agent_id: "missing",
    });
    expect(waitBad.isError).toBe(true);

    const waitOk = await tools.get("wait_agent")!.execute({
      agent_id: child,
      timeout_ms: 1000,
    });
    expect(waitOk.isError).not.toBe(true);
    expect(waitOk.content).toMatch(/wait_agent completed/);

    const denied = createToolRegistry();
    bindSubagentTools(denied, {
      runtime,
      parentSessionId: grand,
      maxDepth: 2,
    });
    const out = await denied.get("subagent")!.execute({
      prompt: "should fail",
    });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/max depth/);
  });

  it("caps concurrent active children under one parent", async () => {
    const store = createMemorySessionStore();
    const active = new Set<string>();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      productDir: mkdtempSync(path.join(tmpdir(), "xrk-sa-active-")),
      drain: {
        wake() {},
        async cancel() {},
        isActive(sessionId: string) {
          return active.has(sessionId);
        },
        async run() {},
      },
      resolveAgent: async () => stubAgent(),
      defaultAgentPreset: "harness",
    });
    const parent = runtime.ensureSession("parent");
    runtime.sessionAgentPresets.set(parent, "harness");
    const childA = runtime.ensureSession("child-a");
    const childB = runtime.ensureSession("child-b");
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: childA,
      mode: "continuable",
      label: "a",
    });
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: childB,
      mode: "continuable",
      label: "b",
    });
    active.add(childA);
    active.add(childB);

    const tools = createToolRegistry();
    bindSubagentTools(tools, {
      runtime,
      parentSessionId: parent,
      maxActiveChildren: 2,
    });
    const out = await tools.get("subagent")!.execute({ prompt: "third" });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/max active children/);
  });

  it("refuses spawn when the session badge has subagents off", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      productDir: mkdtempSync(path.join(tmpdir(), "xrk-sa-frugal-")),
      drain: drain(),
      resolveAgent: async () => stubAgent(),
      defaultAgentPreset: "frugal",
    });
    const parent = runtime.ensureSession("parent");
    runtime.sessionAgentPresets.set(parent, "frugal");
    const tools = createToolRegistry();
    // Simulate a stale AgentHandle that still carries the tool.
    bindSubagentTools(tools, { runtime, parentSessionId: parent });
    const out = await tools.get("subagent")!.execute({ prompt: "nope" });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/subagents off/);
    expect(out.content).toMatch(/frugal/);
  });

  it("advertises provider/model pin fields on the subagent tool schema", () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      productDir: mkdtempSync(path.join(tmpdir(), "xrk-sa-model-schema-")),
      drain: drain(),
      resolveAgent: async () => stubAgent(),
      defaultAgentPreset: "harness",
    });
    const parent = runtime.ensureSession("parent");
    runtime.sessionAgentPresets.set(parent, "harness");
    const tools = createToolRegistry();
    bindSubagentTools(tools, { runtime, parentSessionId: parent });
    const def = tools.get("subagent")!;
    const props = (def.parameters as { properties: Record<string, unknown> }).properties;
    expect(props.provider).toBeTruthy();
    expect(props.model).toBeTruthy();
    expect(props.reasoning_effort).toBeTruthy();
    expect(def.description).toMatch(/provider \/ model/);
    expect(def.dynamicSchema?.()?.description).toContain("mem_seed_researcher");
  });

  it("spills an oversized child answer to a file the parent can read", async () => {
    const prevHome = process.env.XRK_HOME;
    const home = mkdtempSync(path.join(tmpdir(), "xrk-sa-spill-"));
    process.env.XRK_HOME = home;
    try {
      const store = createMemorySessionStore();
      const runtime = createFaceRuntime({
        store,
        workspaceRoot: process.cwd(),
        productDir: mkdtempSync(path.join(tmpdir(), "xrk-sa-spill-dir-")),
        drain: drain(),
        resolveAgent: async () => stubAgent(),
        defaultAgentPreset: "harness",
      });
      const parent = runtime.ensureSession("parent");
      runtime.sessionAgentPresets.set(parent, "harness");
      const child = runtime.ensureSession("child");
      runtime.subagents.attach({
        parentSessionId: parent,
        childSessionId: child,
        mode: "continuable",
        label: "c",
      });
      const fat = "结论段落。".repeat(4_000);
      store.append(child, {
        type: "assistant/message",
        ts: Date.now(),
        turnId: "t1",
        stepId: "s1",
        content: fat,
      } as never);

      const tools = createToolRegistry();
      bindSubagentTools(tools, { runtime, parentSessionId: parent });
      const out = await tools.get("wait_agent")!.execute({
        agent_id: child,
        timeout_ms: 1_000,
      });
      const text = String(out.content);
      expect(text).toContain("read_file");
      expect(text).toContain("middle omitted");
      const locator = text.match(/stored at: (.+?)\. Retrieve/)?.[1];
      expect(locator).toBeTruthy();
      expect(locator!.replace(/\\/g, "/")).toContain("/spill/tool-outputs/");
      expect(readFileSync(locator!, "utf8")).toBe(fat);
    } finally {
      if (prevHome === undefined) delete process.env.XRK_HOME;
      else process.env.XRK_HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("keeps a short child answer inline", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      productDir: mkdtempSync(path.join(tmpdir(), "xrk-sa-short-")),
      drain: drain(),
      resolveAgent: async () => stubAgent(),
      defaultAgentPreset: "harness",
    });
    const parent = runtime.ensureSession("parent");
    runtime.sessionAgentPresets.set(parent, "harness");
    const child = runtime.ensureSession("child");
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: child,
      mode: "continuable",
      label: "c",
    });
    store.append(child, {
      type: "assistant/message",
      ts: Date.now(),
      turnId: "t1",
      stepId: "s1",
      content: "结论只有一行。",
    } as never);

    const tools = createToolRegistry();
    bindSubagentTools(tools, { runtime, parentSessionId: parent });
    const out = await tools.get("wait_agent")!.execute({
      agent_id: child,
      timeout_ms: 1_000,
    });
    expect(String(out.content)).toContain("结论只有一行。");
    expect(String(out.content)).not.toContain("read_file");
  });

  it("never reports the parent's own last reply as a seeded child's answer", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      productDir: mkdtempSync(path.join(tmpdir(), "xrk-sa-seed-")),
      drain: drain(),
      resolveAgent: async () => stubAgent(),
      defaultAgentPreset: "harness",
    });
    const parent = runtime.ensureSession("parent");
    runtime.sessionAgentPresets.set(parent, "harness");
    const child = runtime.ensureSession("child");
    runtime.sessionAgentPresets.set(child, "harness");
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: child,
      mode: "continuable",
      label: "seeded",
    });

    // The seeded prefix is the parent's transcript …
    store.append(child, {
      type: "assistant/message",
      ts: Date.now(),
      turnId: "parent-turn",
      stepId: "p1",
      content: "父会话上一轮的回答",
    } as never);
    const seedCut = store.get(child).events.length;
    runtime.subagents.setSeedEventCount(child, seedCut);
    // … and the child's real answer follows it.
    store.append(child, {
      type: "assistant/message",
      ts: Date.now() + 1,
      turnId: "child-turn",
      stepId: "c1",
      content: "子代理真正的结论",
    } as never);

    const tools = createToolRegistry();
    bindSubagentTools(tools, { runtime, parentSessionId: parent });
    const out = await tools.get("wait_agent")!.execute({
      agent_id: child,
      timeout_ms: 1_000,
    });
    const text = String(out.content);
    expect(text).toContain("子代理真正的结论");
    expect(text).not.toContain("父会话上一轮的回答");
  });

  it("refuses a task_id another child already owns", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      productDir: mkdtempSync(path.join(tmpdir(), "xrk-sa-taskid-")),
      drain: drain(),
      resolveAgent: async () => stubAgent(),
      defaultAgentPreset: "harness",
    });
    const parent = runtime.ensureSession("parent");
    runtime.sessionAgentPresets.set(parent, "harness");
    const first = runtime.ensureSession("child-a");
    runtime.agentTeamTasks.open({
      parentSessionId: parent,
      title: "first",
      childSessionId: first,
      taskId: "shared-id",
    });

    const tools = createToolRegistry();
    bindSubagentTools(tools, { runtime, parentSessionId: parent });
    const out = await tools.get("subagent")!.execute({
      prompt: "second child",
      task_id: "shared-id",
    });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/already bound to child/);
    // Refused before allocation: no child session was created for it.
    expect(store.list().sort()).toEqual([parent, first].sort());
  });

  it("detach drops the link so a discarded spawn leaves no catalog entry", () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      productDir: mkdtempSync(path.join(tmpdir(), "xrk-sa-detach-")),
      drain: drain(),
      resolveAgent: async () => stubAgent(),
      defaultAgentPreset: "harness",
    });
    const parent = runtime.ensureSession("parent");
    const child = runtime.ensureSession("child");
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: child,
      mode: "continuable",
      label: "c",
    });
    expect(runtime.subagents.listDelegated(parent)).toHaveLength(1);
    expect(runtime.subagents.detach(child)).toBe(true);
    expect(runtime.subagents.listDelegated(parent)).toHaveLength(0);
    expect(runtime.subagents.getByChild(child)).toBeUndefined();
    // Idempotent: a second detach is a no-op, not a throw.
    expect(runtime.subagents.detach(child)).toBe(false);
  });

  it("round-trips the seed boundary through the registry sidecar", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sa-seed-persist-"));
    try {
      const file = path.join(dir, "subagents.json");
      const first = new FaceSubagentRegistry(file);
      first.attach({
        parentSessionId: "p",
        childSessionId: "c",
        mode: "continuable",
        label: "seeded",
      });
      first.setSeedEventCount("c", 42);
      const reloaded = new FaceSubagentRegistry(file);
      expect(reloaded.getByChild("c")?.seedEventCount).toBe(42);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips the spawn role so tool projection survives a restart", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sa-role-persist-"));
    try {
      const file = path.join(dir, "subagents.json");
      const first = new FaceSubagentRegistry(file);
      first.attach({
        parentSessionId: "p",
        childSessionId: "c",
        mode: "one-shot",
        label: "review",
        role: "reviewer",
      });
      expect(new FaceSubagentRegistry(file).getByChild("c")?.role).toBe(
        "reviewer",
      );

      // A corrupt / unknown persisted role degrades to "no projection"
      // instead of throwing at registry load.
      const bad = path.join(dir, "bad.json");
      writeFileSync(
        bad,
        JSON.stringify({
          links: [
            {
              parentSessionId: "p",
              childSessionId: "x",
              mode: "one-shot",
              label: "x",
              role: "wizard",
            },
          ],
        }),
        "utf8",
      );
      expect(new FaceSubagentRegistry(bad).getByChild("x")?.role).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("salvages a timed-out child's answer and names the resume verbs", () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      productDir: mkdtempSync(path.join(tmpdir(), "xrk-sa-salvage-")),
      drain: drain(),
      resolveAgent: async () => stubAgent(),
      defaultAgentPreset: "harness",
    });
    const parent = runtime.ensureSession("parent");
    runtime.sessionAgentPresets.set(parent, "harness");
    const child = runtime.ensureSession("child");
    runtime.sessionAgentPresets.set(child, "harness");
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: child,
      mode: "continuable",
      label: "c",
    });
    // Seeded parent prefix plus the child's own answer: only the latter counts.
    store.append(child, {
      type: "assistant/message",
      ts: Date.now(),
      turnId: "parent-turn",
      stepId: "p1",
      content: "父会话上一轮的回答",
    } as never);
    runtime.subagents.setSeedEventCount(child, store.get(child).events.length);
    store.append(child, {
      type: "assistant/message",
      ts: Date.now() + 1,
      turnId: "child-turn",
      stepId: "c1",
      content: "子代理在超时前写完的结论",
    } as never);

    expect(lastAssistantBodyText(childOwnedEvents(runtime, child))).toBe(
      "子代理在超时前写完的结论",
    );

    const hint = childResumeHint(child);
    expect(hint).toContain("session_read");
    expect(hint).toContain("followup_task");
    expect(hint).toContain("wait_agent");
    expect(hint).toContain(child);

    // A child that never answered has nothing to salvage: cancel stays right.
    const mute = runtime.ensureSession("mute");
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: mute,
      mode: "continuable",
      label: "m",
    });
    expect(lastAssistantBodyText(childOwnedEvents(runtime, mute))).toBe("");
  });

  it("tells a rate-limited child apart from a wedged one", () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      productDir: mkdtempSync(path.join(tmpdir(), "xrk-sa-retry-")),
      drain: drain(),
      resolveAgent: async () => stubAgent(),
      defaultAgentPreset: "harness",
    });
    const parent = runtime.ensureSession("parent");
    runtime.sessionAgentPresets.set(parent, "harness");
    const child = runtime.ensureSession("child");
    runtime.sessionAgentPresets.set(child, "harness");
    runtime.subagents.attach({
      parentSessionId: parent,
      childSessionId: child,
      mode: "continuable",
      label: "c",
    });
    store.append(child, {
      type: "llm/retry",
      ts: Date.now(),
      turnId: "t1",
      stepId: "s1",
      retryId: "r1",
      retry: 3,
      maxRetries: 5,
      delayMs: 12_000,
      mode: "normal",
      failure: { message: "rate limited", code: "RATE_LIMIT", status: 429 },
      provider: "test-provider",
    } as never);

    const notice = lastModelRetryNotice(childOwnedEvents(runtime, child));
    expect(notice).toContain("3/5");
    expect(notice).toContain("RATE_LIMIT");
    expect(notice).toContain("status 429");
    expect(notice).toContain("12s backoff");

    // Once the backoff elapsed the retry is history, not a live diagnosis.
    store.append(child, {
      type: "llm/retry-started",
      ts: Date.now() + 1,
      turnId: "t1",
      stepId: "s1",
      retryId: "r1",
      retry: 3,
    } as never);
    expect(lastModelRetryNotice(childOwnedEvents(runtime, child))).toBeUndefined();
  });

  it("separates a finished child from one the parent wait cut off", () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      productDir: mkdtempSync(path.join(tmpdir(), "xrk-sa-outcome-")),
      drain: drain(),
      resolveAgent: async () => stubAgent(),
      defaultAgentPreset: "harness",
    });
    const parent = runtime.ensureSession("parent");
    runtime.sessionAgentPresets.set(parent, "harness");
    const done = runtime.ensureSession("done");
    const killed = runtime.ensureSession("killed");
    const open = runtime.ensureSession("open");

    const now = 1_800_000_000_000;
    store.append(done, {
      type: "turn/end",
      ts: now - 5_000,
      turnId: "t1",
      reason: { kind: "completed" },
    } as never);
    store.append(killed, {
      type: "turn/end",
      ts: now - 120_000,
      turnId: "t2",
      reason: { kind: "aborted", reason: { kind: "parent" } },
    } as never);
    store.append(open, {
      type: "assistant/chunk",
      ts: now - 30_000,
      turnId: "t3",
      stepId: "s1",
      kind: "text",
      text: "still working",
    } as never);

    expect(formatChildOutcome(readSessionEvents(store, done), now)).toMatch(
      /^finished/,
    );
    expect(formatChildOutcome(readSessionEvents(store, killed), now)).toBe(
      "aborted by parent · last event 2m ago",
    );
    expect(formatChildOutcome(readSessionEvents(store, open), now)).toBe(
      "turn still open · last event 30s ago",
    );
  });
});
