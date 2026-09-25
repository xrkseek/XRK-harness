/** Plan / Office / Status preview loaders read existing RPC envelopes. */
import { describe, expect, it, vi } from "vitest";
import {
  loadPreviewTabs,
  parseOfficePreview,
  parsePlanPreview,
  parseSessionStatus,
} from "../src/client/preview-load.ts";

const sampleStatus = {
  sessionId: "s1",
  badge: "(default)",
  permission: "default",
  plan: "off" as const,
  theme: "system",
  model: { provider: "deepseek", model: "deepseek-chat" },
  cwd: "/tmp",
  events: 3,
  jobs: [{ id: "j1", status: "running", label: "build" }],
  subagents: {
    live: [
      {
        id: "c1",
        activity: "running" as const,
        mode: "continuable",
        label: "worker",
        liveTool: "bash",
      },
    ],
    graph: {
      nodes: [
        { id: "s1", label: "s1", role: "delegator" },
        { id: "c1", label: "worker", role: "worker" },
      ],
      edges: [{ from: "s1", to: "c1", kind: "delegates" }],
    },
    quota: {
      depth: 0,
      maxDepth: 2,
      active: 1,
      maxActive: 2,
      delegated: 1,
      slotsFree: 1,
    },
  },
  cost: {
    input: 10,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    cost: 0.001,
    byModel: {},
    byProviderModel: {
      "deepseek:deepseek-chat": {
        input: 10,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        cost: 0.001,
      },
    },
  },
  billing: {
    todayCost: 0.01,
    monthCost: 0.05,
    totalCost: 0.1,
    todayTokens: 12,
    monthTokens: 100,
    byModel: [],
    byProviderModel: [
      {
        key: "deepseek:deepseek-chat",
        input: 80,
        output: 20,
        cost: 0.05,
      },
    ],
    dailyTrend: [
      { date: "2026-09-24", cost: 0.01, tokens: 40 },
      { date: "2026-09-25", cost: 0.04, tokens: 60 },
    ],
  },
  fleet: {
    health: "ok" as const,
    runningJobs: 1,
    runningSubagents: 1,
    slotsFree: 1,
    queuedInbox: 0,
    channelAlerts: 1,
    alerts: [
      {
        id: "im:telegram",
        severity: "info" as const,
        message: "IM Telegram is bridge (not long-lived)",
      },
    ],
  },
  timeline: {
    total: 100,
    system: 20,
    tools: 10,
    user: 30,
    inject: 5,
    assistant: 25,
    tool: 10,
    requestCount: 1,
    eventCount: 0,
    injectSources: [] as string[],
    spillCount: 0,
    pruneCount: 0,
  },
  compaction: {
    pipeline: "none" as const,
    stages: [] as ("prune" | "summary")[],
    pruneCount: 0,
    summaryCount: 0,
    spillCount: 0,
    phase: "idle" as const,
  },
  delivery: {
    turnActive: false,
    queued: 0,
    steering: 0,
    compactBlockedByTurn: false,
    queueAcceptedWhileBusy: true as const,
    steerRequiresActiveTurn: true as const,
    note: "idle · queue accepts · compact available when agent idle",
  },
  teamTasks: [] as {
    id: string;
    title: string;
    status: string;
    revision: number;
  }[],
  channels: {
    process: [],
    im: [{ channelId: "telegram", displayName: "Telegram", wired: "bridge" }],
    note: "",
    alerts: [
      {
        id: "im:telegram",
        severity: "info" as const,
        message: "IM Telegram is bridge (not long-lived)",
      },
    ],
  },
};

describe("preview tab envelopes", () => {
  it("reads plan.preview and office status and rejects other bodies", () => {
    expect(
      parsePlanPreview({ ok: true, value: { active: true, pending: false } }),
    ).toEqual({ active: true, pending: false });
    expect(parsePlanPreview({ ok: false })).toBeNull();
    expect(
      parseOfficePreview({
        result: { ok: true, value: { configured: true, connected: false } },
      }),
    ).toEqual({ configured: true, connected: false });
    expect(
      parseOfficePreview({ result: { ok: true, value: { state: "idle" } } }),
    ).toBeNull();
  });

  it("parses Face session.status (same shape as /status)", () => {
    expect(
      parseSessionStatus({ result: { ok: true, value: sampleStatus } }),
    ).toEqual(sampleStatus);
    expect(parseSessionStatus({ result: { ok: false } })).toBeNull();
    expect(
      parseSessionStatus({ result: { ok: true, value: { sessionId: "x" } } }),
    ).toBeNull();
    const parsed = parseSessionStatus({
      result: { ok: true, value: sampleStatus },
    });
    expect(parsed?.fleet.health).toBe("ok");
    expect(parsed?.billing.dailyTrend).toHaveLength(2);
    expect(parsed?.channels.alerts[0]?.id).toBe("im:telegram");
  });

  it("parses teamTasks externalResume · worktreeId for Status actions", () => {
    const withTeam = {
      ...sampleStatus,
      teamTasks: [
        {
          id: "t1",
          title: "ship",
          status: "paused",
          revision: 2,
          childSessionId: "c-ext",
          worktreeId: "lease-1",
          worktreeLeaseStatus: "retained",
          externalResume: "cold" as const,
        },
      ],
    };
    const parsed = parseSessionStatus({
      result: { ok: true, value: withTeam },
    });
    expect(parsed?.teamTasks[0]).toMatchObject({
      id: "t1",
      externalResume: "cold",
      worktreeId: "lease-1",
      worktreeLeaseStatus: "retained",
    });
  });

  it("parses compaction.spillPaths entries (object or legacy string)", () => {
    const withSpill = {
      ...sampleStatus,
      compaction: {
        ...sampleStatus.compaction,
        spillCount: 2,
        spillPaths: [
          {
            path: "/tmp/spill/a.txt",
            name: "a.txt",
            bytes: 12,
            preview: "hello",
            tool: "bash",
          },
          "/tmp/spill/legacy.txt",
        ],
      },
    };
    const parsed = parseSessionStatus({
      result: { ok: true, value: withSpill },
    });
    expect(parsed?.compaction.spillPaths).toEqual([
      {
        path: "/tmp/spill/a.txt",
        name: "a.txt",
        bytes: 12,
        preview: "hello",
        tool: "bash",
      },
      { path: "/tmp/spill/legacy.txt", name: "legacy.txt" },
    ]);
  });

  it("loads plan · office · status and keeps tabs when one request fails", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("plan.preview")) {
        return new Response(
          JSON.stringify({ ok: true, value: { active: false, pending: true } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("session.status")) {
        return new Response(
          JSON.stringify({ result: { ok: true, value: sampleStatus } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error("office down");
    });
    const loaded = await loadPreviewTabs("s1", fetchImpl);
    expect(loaded.plan).toEqual({ active: false, pending: true });
    expect(loaded.office).toBeNull();
    expect(loaded.status?.sessionId).toBe("s1");
    expect(loaded.status?.jobs[0]?.id).toBe("j1");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const planCall = fetchImpl.mock.calls[0];
    expect(String(planCall?.[0])).toBe("/sidebar/api/plan.preview");
    expect(JSON.parse(String(planCall?.[1]?.body))).toEqual({ sessionId: "s1" });
    const officeCall = fetchImpl.mock.calls[1];
    expect(String(officeCall?.[0])).toBe("/office/connection.status");
    const statusCall = fetchImpl.mock.calls[2];
    expect(String(statusCall?.[0])).toBe("/api/session.status");
    expect(JSON.parse(String(statusCall?.[1]?.body))).toMatchObject({
      type: "client-request",
      payload: { sessionId: "s1" },
    });
  });
});
