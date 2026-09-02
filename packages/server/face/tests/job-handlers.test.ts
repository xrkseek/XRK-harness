import { describe, expect, it } from "vitest";
import {
  createLocalShell,
  createSessionScopedShell,
} from "@xrkseek/exec-shell";
import { createLocalSubprocess } from "@xrkseek/exec-subprocess";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";

const BLOCK = `${process.platform === "win32" ? "&" : ""} '${process.execPath}' -e 'setInterval(()=>{},999999)'`;

describe("job.kill / job.background", () => {
  it("kill requests cancellation for a session-owned job", async () => {
    const root = createLocalShell({ subprocess: createLocalSubprocess() });
    const runtime = createBareFaceRuntime({ shell: root });
    const scoped = createSessionScopedShell(root, "sess-a");
    const started = await scoped.startJob(BLOCK);
    const result = await dispatchFaceMethod(runtime, "job.kill", "k1", {
      sessionId: "sess-a",
      jobId: started.id,
    });
    expect(result.result).toEqual({
      ok: true,
      value: { outcome: "requested" },
    });
    expect(root.listJobsNow()[0]?.status).toBe("stopping");
  });

  it("background detaches a foreground wait", async () => {
    const root = createLocalShell({ subprocess: createLocalSubprocess() });
    const runtime = createBareFaceRuntime({ shell: root });
    const scoped = createSessionScopedShell(root, "sess-b");
    const started = await scoped.startJob(BLOCK);
    scoped.attachForegroundWait(started.id);
    const result = await dispatchFaceMethod(runtime, "job.background", "b1", {
      sessionId: "sess-b",
      jobId: started.id,
    });
    expect(result.result).toEqual({
      ok: true,
      value: { accepted: true },
    });
    await root.killJob(started.id);
  });

  it("rejects foreign session jobs", async () => {
    const root = createLocalShell({ subprocess: createLocalSubprocess() });
    const runtime = createBareFaceRuntime({ shell: root });
    const scoped = createSessionScopedShell(root, "owner");
    const started = await scoped.startJob(BLOCK);
    const result = await dispatchFaceMethod(runtime, "job.kill", "k2", {
      sessionId: "other",
      jobId: started.id,
    });
    expect(result.result.ok).toBe(false);
    if (!result.result.ok) {
      expect(result.result.error?.code).toBe("job-not-found");
    }
    await root.killJob(started.id);
  });
});
