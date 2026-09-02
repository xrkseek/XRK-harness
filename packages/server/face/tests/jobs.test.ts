import { describe, expect, it } from "vitest";
import {
  admitPrompt,
  createMemorySessionStore,
} from "@xrkseek/core-session";
import { WebSocket } from "ws";
import {
  createFaceOnlyServer,
  createFaceRuntime,
  formatJobCompletionNotice,
  jobViews,
  type FaceJobsSource,
  type JobView,
} from "../src/index.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";

function runningJob(over: Partial<JobView> = {}): JobView {
  return {
    id: "bash-1",
    kind: "bash",
    label: "pnpm run build",
    status: "running",
    startedAt: 1_000,
    ...over,
  };
}

function memoryJobs(initial: JobView[] = []): {
  source: FaceJobsSource;
  set(next: JobView[]): void;
} {
  let items = [...initial];
  const listeners = new Set<() => void>();
  return {
    source: {
      list: () => items,
      onJobsChanged(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    set(next) {
      items = [...next];
      for (const listener of listeners) listener();
    },
  };
}

describe("jobViews (DSH apiproxy)", () => {
  it("drops ownerSession / reported / outputLimitBytes", () => {
    const views = jobViews([
      {
        ...runningJob(),
        ...{
          ownerSession: "s",
          reported: true,
          outputLimitBytes: 1024,
        },
      } as JobView & {
        ownerSession: string;
        reported: boolean;
        outputLimitBytes: number;
      },
    ]);
    expect(Object.keys(views[0]!).sort()).toEqual([
      "id",
      "kind",
      "label",
      "startedAt",
      "status",
    ]);
  });

  it("passes foreground when set", () => {
    const views = jobViews([runningJob({ foreground: true })]);
    expect(views[0]?.foreground).toBe(true);
  });
});

describe("session/jobs without the registry", () => {
  it("jobViewsFor is undefined so mux emits no frames", () => {
    const runtime = createBareFaceRuntime();
    expect(runtime.jobViewsFor("s")).toBeUndefined();
    const seen: string[] = [];
    runtime.bus.subscribeMux((_id, frame) => {
      seen.push(frame.type);
    });
    runtime.publishJobs("s");
    expect(seen).toEqual([]);
  });
});

describe("session/jobs subscription baseline", () => {
  it("is omitted for a session with no tasks — absence is the empty set", async () => {
    const jobs = memoryJobs();
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      version: "test",
      jobs: jobs.source,
      drain: {
        wake() {},
        async cancel() {},
        isActive() {
          return false;
        },
      },
      resolveAgent: async (sessionId) =>
        ({
          admit: (content, opts) =>
            admitPrompt(store, sessionId, content, opts),
          pendingAdmits: () => [],
          continueTurn: async () => ({}) as never,
          run: async () => ({}) as never,
          isBusy: () => false,
          abort() {},
          setApprovalHandler() {},
        }) as never,
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c1", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    expect(runtime.jobViewsFor(sessionId)).toEqual([]);

    const face = createFaceOnlyServer(runtime, {
      apiKey: "k",
      checkAuth: (req) =>
        req.headers.authorization === "Bearer k" ||
        req.headers["x-api-key"] === "k",
    });
    const { port } = await face.listen();
    const types: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/events.mux`, {
        headers: { authorization: "Bearer k" },
      });
      const done = () => {
        clearTimeout(timer);
        ws.close();
        resolve();
      };
      const timer = setTimeout(done, 800);
      ws.on("message", (data) => {
        const env = JSON.parse(String(data)) as { payload: { type: string } };
        types.push(env.payload.type);
        if (types.includes("session/subscribed")) done();
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    expect(types).toContain("session/subscribed");
    expect(types).not.toContain("session/jobs");
    await face.close();
  });

  it("carries the live set when the stream opens", async () => {
    const jobs = memoryJobs([runningJob()]);
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      version: "test",
      jobs: jobs.source,
      drain: {
        wake() {},
        async cancel() {},
        isActive() {
          return false;
        },
      },
      resolveAgent: async () => ({}) as never,
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c1", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const face = createFaceOnlyServer(runtime, {
      apiKey: "k",
      checkAuth: (req) => req.headers["x-api-key"] === "k",
    });
    const { port } = await face.listen();
    const frames: { type: string; jobs?: JobView[]; sessionId?: string }[] = [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/events.mux`, {
        headers: { "x-api-key": "k" },
      });
      const done = () => {
        clearTimeout(timer);
        ws.close();
        resolve();
      };
      const timer = setTimeout(done, 800);
      ws.on("message", (data) => {
        const env = JSON.parse(String(data)) as {
          payload: { type: string; jobs?: JobView[]; sessionId?: string };
        };
        frames.push(env.payload);
        if (frames.some((f) => f.type === "session/jobs")) done();
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    const baseline = frames.find((f) => f.type === "session/jobs");
    expect(baseline?.sessionId).toBe(sessionId);
    expect(baseline?.jobs).toEqual([runningJob()]);
    await face.close();
  });
});

describe("session/jobs change pushes", () => {
  it("pushes the whole set on change, including []", () => {
    const jobs = memoryJobs([runningJob()]);
    const runtime = createBareFaceRuntime({ jobs: jobs.source });
    const store = runtime.store;
    const a = runtime.ensureSession("a");
    const seen: JobView[][] = [];
    runtime.bus.subscribeMux((_id, frame) => {
      if (frame.type === "session/jobs" && frame.sessionId === a) {
        seen.push(frame.jobs as JobView[]);
      }
    });
    jobs.set([{ ...runningJob(), status: "killed", finishedAt: 2_000 }]);
    jobs.set([]);
    expect(seen[0]?.[0]?.status).toBe("killed");
    expect(seen[1]).toEqual([]);
    void store;
  });

  it("fans an unowned change out to every session", () => {
    const jobs = memoryJobs();
    const runtime = createBareFaceRuntime({ jobs: jobs.source });
    runtime.ensureSession("one");
    runtime.ensureSession("two");
    const sessionIds: string[] = [];
    runtime.bus.subscribeMux((_id, frame) => {
      if (frame.type === "session/jobs") sessionIds.push(frame.sessionId);
    });
    jobs.set([runningJob({ label: "open to every caller" })]);
    expect(new Set(sessionIds).size).toBe(2);
  });
});

describe("job completion notices (DSH tool-jobs wakeup)", () => {
  it("formatJobCompletionNotice matches DSH copy", () => {
    expect(
      formatJobCompletionNotice({
        id: "pty-send-1",
        kind: "pty-send",
        label: "pty-1: ls",
        status: "completed",
        detail: "wait: stdin_read",
        startedAt: 1,
        finishedAt: 2,
      }),
    ).toBe(
      "background job pty-send-1 (pty-send: pty-1: ls) finished [status: completed, wait: stdin_read]. Read its output with job_output.",
    );
  });

  it("idle agent: admit + wake on settle; already-settled at bind is silent", async () => {
    const store = createMemorySessionStore();
    const wakes: string[] = [];
    const admits: { content: string; delivery?: string }[] = [];
    let items: JobView[] = [
      runningJob({ id: "prior-1", status: "completed", finishedAt: 2 }),
    ];
    const listeners = new Set<() => void>();
    const agentJobs = {
      list: () => items,
      onJobsChanged(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      version: "test",
      drain: {
        wake(sessionId) {
          wakes.push(sessionId);
        },
        async cancel() {},
        isActive() {
          return false;
        },
      },
      resolveAgent: async (sessionId) =>
        ({
          admit: (content, opts) => {
            const receipt = admitPrompt(store, sessionId, content, opts);
            admits.push({
              content: typeof content === "string" ? content : String(content),
              ...(opts?.delivery ? { delivery: opts.delivery } : {}),
            });
            return receipt;
          },
          pendingAdmits: () => [],
          continueTurn: async () => ({}) as never,
          run: async () => ({}) as never,
          isBusy: () => false,
          abort() {},
          setApprovalHandler() {},
          jobs: agentJobs,
        }) as never,
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    await runtime.resolveAgent(sessionId);
    expect(admits).toEqual([]);

    items = [
      ...items,
      {
        id: "bash-2",
        kind: "bash",
        label: "echo hi",
        status: "completed",
        startedAt: 3,
        finishedAt: 4,
      },
    ];
    for (const listener of listeners) listener();
    expect(admits).toHaveLength(1);
    expect(admits[0]?.content).toContain("background job bash-2");
    expect(admits[0]?.delivery).toBe("steer");
    expect(wakes).toContain(sessionId);
  });

  it("skips notice when agent job already reported (read/wait/kill)", async () => {
    const store = createMemorySessionStore();
    const wakes: string[] = [];
    const admits: string[] = [];
    let items: Array<JobView & { reported?: boolean }> = [];
    const listeners = new Set<() => void>();
    const agentJobs = {
      list: () => items,
      onJobsChanged(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      version: "test",
      drain: {
        wake(sessionId) {
          wakes.push(sessionId);
        },
        async cancel() {},
        isActive() {
          return false;
        },
      },
      resolveAgent: async (sessionId) =>
        ({
          admit: (content, opts) => {
            admits.push(typeof content === "string" ? content : String(content));
            return admitPrompt(store, sessionId, content, opts);
          },
          pendingAdmits: () => [],
          continueTurn: async () => ({}) as never,
          run: async () => ({}) as never,
          isBusy: () => false,
          abort() {},
          setApprovalHandler() {},
          jobs: agentJobs,
        }) as never,
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    await runtime.resolveAgent(sessionId);

    items = [
      {
        id: "pty-send-1",
        kind: "pty-send",
        label: "pty-1: ls",
        status: "completed",
        detail: "wait: stdin_read",
        startedAt: 1,
        finishedAt: 2,
        reported: true,
      },
    ];
    for (const listener of listeners) listener();
    expect(admits).toEqual([]);
    expect(wakes).toEqual([]);
  });

  it("busy agent still wakes; over-budget idle admits without wake", async () => {
    const store = createMemorySessionStore();
    const wakes: string[] = [];
    const deliveries: string[] = [];
    let busy = true;
    let items: JobView[] = [];
    const listeners = new Set<() => void>();
    const agentJobs = {
      list: () => items,
      onJobsChanged(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      version: "test",
      drain: {
        wake(sessionId) {
          wakes.push(sessionId);
        },
        async cancel() {},
        isActive() {
          return false;
        },
      },
      resolveAgent: async (sessionId) =>
        ({
          admit: (content, opts) => {
            if (opts?.delivery) deliveries.push(opts.delivery);
            return admitPrompt(store, sessionId, content, opts);
          },
          pendingAdmits: () => [],
          continueTurn: async () => ({}) as never,
          run: async () => ({}) as never,
          isBusy: () => busy,
          abort() {},
          setApprovalHandler() {},
          jobs: agentJobs,
        }) as never,
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    await runtime.resolveAgent(sessionId);

    const settle = (id: string) => {
      items = [
        ...items.filter((j) => j.id !== id),
        {
          id,
          kind: "bash",
          label: id,
          status: "completed" as const,
          startedAt: 1,
          finishedAt: 2,
        },
      ];
      for (const listener of listeners) listener();
    };

    settle("b1");
    expect(wakes.filter((s) => s === sessionId)).toHaveLength(1);
    expect(deliveries.every((d) => d === "steer")).toBe(true);

    busy = false;
    wakes.length = 0;
    settle("b2");
    settle("b3");
    settle("b4");
    expect(wakes.filter((s) => s === sessionId)).toHaveLength(3);
    wakes.length = 0;
    settle("b5");
    expect(wakes.filter((s) => s === sessionId)).toHaveLength(0);
    const pending = store
      .get(sessionId)
      .events.filter((e) => e.type === "prompt/admitted");
    expect(pending.length).toBeGreaterThanOrEqual(5);
  });
});
