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
    byModel: {
      "deepseek-chat": {
        input: 10,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        cost: 0.001,
      },
    },
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
    byModel: [
      { key: "deepseek-chat", input: 80, output: 20, cost: 0.05 },
    ],
    byProviderModel: [
      {
        key: "deepseek:deepseek-chat",
        input: 80,
        output: 20,
        cost: 0.05,
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
