import { describe, expect, it, vi } from "vitest";
import { createBashTools, createLocalShell } from "../src/index.js";
import type { SubprocessService } from "@xrkseek/exec-subprocess";

function stubSubprocess(spawn = vi.fn()) {
  const service = {
    spawn: spawn.mockImplementation(async () => ({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      killed: false,
    })),
    start: vi.fn(() => ({
      pid: 1,
      kill: () => {},
      result: async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        killed: false,
      }),
    })),
  } as unknown as SubprocessService;
  return { service, spawn };
}

describe("shell defaultCwd (workspace root)", () => {
  it("createLocalShell uses defaultCwd when run omits cwd", async () => {
    const { service, spawn } = stubSubprocess();
    const shell = createLocalShell({
      subprocess: service,
      backend: "bash",
      defaultCwd: "C:\\ws\\project",
    });
    await shell.run("pwd");
    expect(spawn).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ cwd: "C:\\ws\\project" }),
    );
  });

  it("createBashTools passes defaultCwd into shell.run", async () => {
    const run = vi.fn(async () => ({
      stdout: "C:\\ws\\project\n",
      stderr: "",
      exitCode: 0,
    }));
    const shell = {
      run,
      startJob: vi.fn(),
      listJobs: async () => [],
      listJobsNow: () => [],
      killJob: async () => "requested" as const,
      startManagedJob: () => ({ id: "x" }),
      readJobOutput: () => "",
      waitJob: async () => {},
      markJobReported: () => {},
      onJobsChanged: () => () => {},
      dispose: async () => {},
    };
    const bash = createBashTools(shell, {
      defaultCwd: "C:\\ws\\project",
    }).find((t) => t.name === "bash")!;
    await bash.execute({ command: "pwd" });
    expect(run).toHaveBeenCalledWith(
      "pwd",
      "C:\\ws\\project",
      expect.anything(),
    );
  });

  it("relative workdir joins defaultCwd", async () => {
    const { service, spawn } = stubSubprocess();
    const shell = createLocalShell({
      subprocess: service,
      backend: "bash",
      defaultCwd: "C:\\ws\\project",
    });
    await shell.run("ls", "src");
    expect(spawn.mock.calls[0]![1].cwd).toMatch(/project[/\\]src$/i);
  });
});
