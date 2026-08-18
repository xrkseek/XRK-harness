import { describe, expect, it } from "vitest";
import { createLocalSubprocess } from "@xrkseek/exec-subprocess";
import { createLocalShell, toJobView } from "../src/index.js";

function sleepCmd(ms: number): string {
  return `node -e "setTimeout(()=>{},${ms})"`;
}

describe("shell background jobs", () => {
  it("startJob → listJobs running → killJob", async () => {
    const shell = createLocalShell({
      subprocess: createLocalSubprocess(),
      backend: process.platform === "win32" ? "cmd" : "bash",
    });

    const started = await shell.startJob(sleepCmd(8000));
    expect(started.id).toMatch(/^job_/);

    const listed = await shell.listJobs();
    const hit = listed.find((j) => j.id === started.id);
    expect(hit?.status).toBe("running");

    await shell.killJob(started.id);
    const after = (await shell.listJobs()).find((j) => j.id === started.id);
    expect(after?.status).toBe("killed");
    expect(after?.finishedAt).toBeTypeOf("number");
  });

  it("killJob unknown id throws", async () => {
    const shell = createLocalShell({
      subprocess: createLocalSubprocess(),
    });
    await expect(shell.killJob("job_missing")).rejects.toThrow(/not found/);
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
      if (status !== "running") break;
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
      status: "killed",
      kind: "bash",
    });
    off();
  });
});
