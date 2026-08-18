import { describe, expect, it } from "vitest";
import { createLocalSubprocess } from "@xrkseek/exec-subprocess";
import { createBashTools, createLocalShell, createSessionScopedShell, toJobView } from "../src/index.js";

function sleepCmd(ms: number): string {
  return `node -e "setTimeout(()=>{},${ms})"`;
}

describe("shell background jobs", () => {
  it("startJob → listJobs running → killJob stopping → settle killed", async () => {
    const shell = createLocalShell({
      subprocess: createLocalSubprocess(),
      backend: process.platform === "win32" ? "cmd" : "bash",
    });

    const started = await shell.startJob(sleepCmd(8000));
    expect(started.id).toMatch(/^bash-\d+$/);

    const listed = await shell.listJobs();
    const hit = listed.find((j) => j.id === started.id);
    expect(hit?.status).toBe("running");
    expect(hit?.kind).toBe("bash");

    const outcome = await shell.killJob(started.id);
    expect(outcome).toBe("requested");
    const stopping = (await shell.listJobs()).find((j) => j.id === started.id);
    expect(stopping?.status).toBe("stopping");
    expect(stopping?.reported).toBe(true);

    await shell.waitJob(started.id, 5_000);
    const after = (await shell.listJobs()).find((j) => j.id === started.id);
    expect(after?.status).toBe("killed");
    expect(after?.finishedAt).toBeTypeOf("number");
  });

  it("killJob unknown id throws", async () => {
    const shell = createLocalShell({
      subprocess: createLocalSubprocess(),
    });
    await expect(shell.killJob("bash-missing")).rejects.toThrow(/not found/);
  });

  it("exited job retains status", async () => {
    const shell = createLocalShell({
      subprocess: createLocalSubprocess(),
      backend: process.platform === "win32" ? "cmd" : "bash",
    });
    const started = await shell.startJob(
      process.platform === "win32"
        ? "echo done"
        : "node -e \"process.stdout.write('done')\"",
    );
    let status = "running";
    for (let i = 0; i < 50; i++) {
      const j = (await shell.listJobs()).find((x) => x.id === started.id);
      status = j?.status ?? "missing";
      if (status !== "running" && status !== "stopping") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(status).toBe("exited");
  });

  it("onJobsChanged fires on start and kill; toJobView is the Face card", async () => {
    const shell = createLocalShell({
      subprocess: createLocalSubprocess(),
      backend: process.platform === "win32" ? "cmd" : "bash",
    });
    const seen: number[] = [];
    const off = shell.onJobsChanged(() => {
      seen.push(shell.listJobsNow().length);
    });
    const started = await shell.startJob(sleepCmd(8000));
    expect(seen[0]).toBe(1);
    expect(toJobView(shell.listJobsNow()[0]!)).toMatchObject({
      id: started.id,
      kind: "bash",
      status: "running",
    });
    await shell.killJob(started.id);
    expect(seen.at(-1)).toBe(1);
    expect(toJobView(shell.listJobsNow()[0]!)).toMatchObject({
      status: "stopping",
      kind: "bash",
    });
    await shell.waitJob(started.id, 5_000);
    expect(toJobView(shell.listJobsNow()[0]!)).toMatchObject({
      status: "killed",
      kind: "bash",
    });
    off();
  });

  it("startManagedJob tracks pty-send; kill + readJobOutput work", async () => {
    const shell = createLocalShell({
      subprocess: createLocalSubprocess(),
    });
    let cancelled = false;
    let resolveDone!: (v: {
      status: "completed" | "killed" | "failed";
      detail?: string;
    }) => void;
    const done = new Promise<{
      status: "completed" | "killed" | "failed";
      detail?: string;
    }>((resolve) => {
      resolveDone = resolve;
    });
    const started = shell.startManagedJob({
      kind: "pty-send",
      label: "pty-1: ls",
      run: () => ({
        cancel: () => {
          cancelled = true;
          resolveDone({ status: "killed", detail: "wait: stdin_read" });
        },
        done,
        readOutput: () => "chunk",
      }),
    });
    expect(started.id).toBe("pty-send-1");
    expect(shell.listJobsNow()[0]).toMatchObject({
      kind: "pty-send",
      status: "running",
    });
    expect(toJobView(shell.listJobsNow()[0]!)).toMatchObject({
      kind: "pty-send",
      label: "pty-1: ls",
    });
    expect(shell.readJobOutput(started.id)).toBe("chunk");
    await shell.killJob(started.id);
    expect(cancelled).toBe(true);
    expect(shell.listJobsNow()[0]?.reported).toBe(true);
    // cancel may settle `done` in the same turn → skipping visible `stopping`.
    await done;
    await shell.waitJob(started.id, 1_000);
    expect(shell.listJobsNow()[0]?.status).toBe("killed");
  });

  it("statusLine detail + reported suppresses duplicate delivery bits", async () => {
    const shell = createLocalShell({
      subprocess: createLocalSubprocess(),
    });
    let resolveDone!: (v: {
      status: "completed" | "killed" | "failed";
      detail?: string;
    }) => void;
    const done = new Promise<{
      status: "completed" | "killed" | "failed";
      detail?: string;
    }>((resolve) => {
      resolveDone = resolve;
    });
    const started = shell.startManagedJob({
      kind: "pty-send",
      label: "pty-1: ls",
      outputLimitBytes: 64,
      run: () => ({
        cancel() {},
        done,
        readOutput: () => "chunk",
      }),
    });
    expect(shell.listJobsNow()[0]?.outputLimitBytes).toBe(64);
    expect(shell.listJobsNow()[0]?.reported).toBe(false);
    resolveDone({ status: "completed", detail: "wait: stdin_read" });
    await shell.waitJob(started.id, 1000);
    const settled = shell.listJobsNow()[0]!;
    expect(settled.status).toBe("exited");
    expect(settled.reported).toBe(true);
    expect(settled.detail).toBe("wait: stdin_read");
    const tools = createBashTools(shell);
    const out = await tools
      .find((t) => t.name === "job_output")!
      .execute({ job_id: started.id });
    expect(out.content).toContain("[status: completed, wait: stdin_read]");
  });

  it("waitJob times out without killing; dispose cancels and clears", async () => {
    const shell = createLocalShell({
      subprocess: createLocalSubprocess(),
    });
    let resolveDone!: (v: {
      status: "completed" | "killed" | "failed";
      detail?: string;
    }) => void;
    const done = new Promise<{
      status: "completed" | "killed" | "failed";
      detail?: string;
    }>((resolve) => {
      resolveDone = resolve;
    });
    let cancelReason: string | undefined;
    const started = shell.startManagedJob({
      kind: "pty-send",
      label: "pty-1: wait",
      run: () => ({
        cancel(reason) {
          cancelReason = reason;
          resolveDone({ status: "killed", detail: reason });
        },
        done,
        readOutput: () => "",
      }),
    });
    await shell.waitJob(started.id, 30);
    expect(shell.listJobsNow()[0]?.status).toBe("running");
    expect(shell.listJobsNow()[0]?.reported).toBe(false);

    await shell.dispose();
    expect(cancelReason).toBe("shell disposed");
    expect(shell.listJobsNow()).toEqual([]);
    expect(() =>
      shell.startManagedJob({
        kind: "pty-send",
        label: "x",
        run: () => ({
          cancel() {},
          done: Promise.resolve({ status: "completed" as const }),
        }),
      }),
    ).toThrow(/disposed/);
  });

  it("maxConcurrentJobs rejects over-admission in the same owner bucket", () => {
    const shell = createLocalShell({
      subprocess: createLocalSubprocess(),
      maxConcurrentJobs: 1,
    });
    let resolveDone!: (v: {
      status: "completed" | "killed" | "failed";
    }) => void;
    const done = new Promise<{
      status: "completed" | "killed" | "failed";
    }>((resolve) => {
      resolveDone = resolve;
    });
    shell.startManagedJob({
      kind: "pty-send",
      label: "one",
      run: () => ({
        cancel() {},
        done,
        readOutput: () => "",
      }),
    });
    expect(() =>
      shell.startManagedJob({
        kind: "pty-send",
        label: "two",
        run: () => ({
          cancel() {},
          done: Promise.resolve({ status: "completed" as const }),
        }),
      }),
    ).toThrow(/limit reached/);
    resolveDone({ status: "completed" });
  });

  it("session-scoped shell fences foreign jobs; concurrent limit is per owner", async () => {
    const root = createLocalShell({
      subprocess: createLocalSubprocess(),
      maxConcurrentJobs: 1,
    });
    const a = createSessionScopedShell(root, "session-a");
    const b = createSessionScopedShell(root, "session-b");
    let resolveA!: (v: { status: "completed" | "killed" | "failed" }) => void;
    const doneA = new Promise<{ status: "completed" | "killed" | "failed" }>(
      (resolve) => {
        resolveA = resolve;
      },
    );
    const started = a.startManagedJob({
      kind: "pty-send",
      label: "owned-by-a",
      run: () => ({
        cancel() {},
        done: doneA,
        readOutput: () => "a",
      }),
    });
    expect(a.listJobsNow()).toHaveLength(1);
    expect(b.listJobsNow()).toHaveLength(0);
    expect(() => b.readJobOutput(started.id)).toThrow(/another session/);

    let resolveB!: (v: { status: "completed" | "killed" | "failed" }) => void;
    const doneB = new Promise<{ status: "completed" | "killed" | "failed" }>(
      (resolve) => {
        resolveB = resolve;
      },
    );
    // Different owner bucket — still admitted under limit 1.
    const startedB = b.startManagedJob({
      kind: "pty-send",
      label: "owned-by-b",
      run: () => ({
        cancel() {},
        done: doneB,
        readOutput: () => "b",
      }),
    });
    expect(startedB.id).toBe("pty-send-2");
    expect(root.listJobsNow()).toHaveLength(2);
    let foreignNotifies = 0;
    const off = a.onJobsChanged(() => {
      foreignNotifies += 1;
    });
    resolveB({ status: "completed" });
    await b.waitJob(startedB.id, 1_000);
    expect(foreignNotifies).toBe(0);
    off();
    resolveA({ status: "completed" });
    await a.waitJob(started.id, 1_000);
    await root.dispose();
  });

  it("job_output wait + job_kill match DSH names", async () => {
    const shell = createLocalShell({
      subprocess: createLocalSubprocess(),
    });
    let resolveDone!: (v: {
      status: "completed" | "killed" | "failed";
      detail?: string;
    }) => void;
    const done = new Promise<{
      status: "completed" | "killed" | "failed";
      detail?: string;
    }>((resolve) => {
      resolveDone = resolve;
    });
    const started = shell.startManagedJob({
      kind: "pty-send",
      label: "pty-1: ls",
      run: () => ({
        cancel() {
          resolveDone({ status: "killed" });
        },
        done,
        readOutput: () => "chunk",
      }),
    });
    const tools = createBashTools(shell);
    const list = tools.find((t) => t.name === "job_list")!;
    const listed = await list.execute({});
    expect(listed.content).toContain("pty-send-1 [pty-send] running");
    const output = tools.find((t) => t.name === "job_output")!;
    const kill = tools.find((t) => t.name === "job_kill")!;
    const first = await output.execute({ job_id: started.id });
    expect(first.content).toContain("chunk");
    expect(first.content).toContain("[status: running]");
    const killed = await kill.execute({ job_id: started.id });
    expect(killed.content).toContain("requested cancellation");
    await done;
    await shell.waitJob(started.id, 1_000);
    const again = await kill.execute({ job_id: started.id });
    expect(again.content).toContain("already finished");
  });
});
