import { describe, expect, it } from "vitest";
import {
  admitPrompt,
  createMemorySessionStore,
} from "@xrkseek/core-session";
import { WebSocket } from "ws";
import {
  createFaceOnlyServer,
  createFaceRuntime,
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
