import { describe, expect, it, vi } from "vitest";
import { createBashTools, createLocalShell } from "../src/index.js";
import type { SubprocessService } from "@xrkseek/exec-subprocess";

function stubSubprocess() {
  const spawn = vi.fn(async () => ({
    stdout: "ok",
    stderr: "",
    exitCode: 0,
    killed: false,
  }));
  const start = vi.fn(() => ({
    pid: 1,
    kill: () => {},
    result: async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
      killed: false,
    }),
  }));
  const service = { spawn, start } as unknown as SubprocessService;
  return { service, spawn, start };
}

describe("shell defaultCwd (workspace root)", () => {
  it("createLocalShell uses defaultCwd when startJob omits cwd", async () => {
    const { service, start } = stubSubprocess();
    const shell = createLocalShell({
      subprocess: service,
      backend: "bash",
      defaultCwd: "C:\\ws\\project",
    });
    await shell.startJob("pwd");
    expect(start).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ cwd: "C:\\ws\\project" }),
    );
  });

  it("createBashTools passes defaultCwd into shell.startJob", async () => {
    const startJob = vi.fn(async () => ({ id: "bash-1" }));
    const shell = {
      startJob,
      listJobs: async () => [],
      listJobsNow: () => [
        {
          id: "bash-1",
          kind: "bash",
          command: "pwd",
          status: "exited",
          startedAt: 0,
          exitCode: 0,
          reported: true,
        },
      ],
      killJob: async () => "requested" as const,
      startManagedJob: () => ({ id: "x" }),
      readJobOutput: () => "C:\\ws\\project\n",
      waitJob: async () => {},
      attachForegroundWait: () => new AbortController().signal,
      detachForegroundWait: () => true,
      markJobReported: () => {},
      onJobsChanged: () => () => {},
      dispose: async () => {},
    };
    const bash = createBashTools(shell, {
      defaultCwd: "C:\\ws\\project",
    }).find((t) => t.name === "bash")!;
    await bash.execute({ command: "pwd" });
    expect(startJob).toHaveBeenCalledWith(
      "pwd",
      "C:\\ws\\project",
      expect.anything(),
    );
  });

  it("relative workdir joins defaultCwd", async () => {
    const { service, start } = stubSubprocess();
    const shell = createLocalShell({
      subprocess: service,
      backend: "bash",
      defaultCwd: "C:\\ws\\project",
    });
    await shell.startJob("ls", "src");
    expect(start.mock.calls[0]![1].cwd).toMatch(/project[/\\]src$/i);
  });
});
