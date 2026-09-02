import { describe, expect, it } from "vitest";
import {
  createBashTools,
  presentBashCall,
  presentBashResult,
} from "../src/index.js";
import type { ShellService } from "../src/index.js";

describe("bash presenters (DSH tool-bash)", () => {
  it("foreground call is a terminal; background is generic execute", () => {
    expect(presentBashCall({ command: "ls -la" })).toEqual({
      card: "terminal",
      title: "ls -la",
    });
    expect(
      presentBashCall({ command: "pwd", cwd: "/tmp" }),
    ).toEqual({
      card: "terminal",
      title: "pwd",
      cwd: "/tmp",
    });
    expect(
      presentBashCall({ command: "sleep 1", background: true }),
    ).toEqual({
      card: "generic",
      title: "sleep 1",
      kind: "execute",
      rawInput: "sleep 1",
    });
  });

  it("malformed args return undefined, never throw", () => {
    expect(presentBashCall({})).toBeUndefined();
    expect(presentBashCall(null)).toBeUndefined();
  });

  it("result strips [exit code: N] into the pill; errors are generic console", () => {
    expect(
      presentBashResult({ command: "false" }, {
        content: "hello\n[stderr]\nnope\n[exit code: 2]",
      }),
    ).toEqual({
      card: "terminal",
      output: "hello\n[stderr]\nnope",
      exitCode: 2,
    });
    expect(
      presentBashResult({ command: "x" }, {
        content: "ENOENT",
        isError: true,
      }),
    ).toEqual({
      card: "generic",
      content: [
        { type: "text", text: "```console\nENOENT\n```" },
      ],
    });
  });

  it("createBashTools hangs presenters; foreground keeps DSH markers, not isError", async () => {
    const shell: ShellService = {
      async startJob() {
        return { id: "job_1" };
      },
      async listJobs() {
        return [];
      },
      listJobsNow() {
        return [
          {
            id: "job_1",
            kind: "bash",
            command: "false",
            status: "exited",
            startedAt: 0,
            exitCode: 2,
            reported: true,
          },
        ];
      },
      async killJob() {
        return "requested" as const;
      },
      startManagedJob() {
        return { id: "pty-send-1" };
      },
      readJobOutput() {
        return "hi";
      },
      async waitJob() {},
      attachForegroundWait() {
        return new AbortController().signal;
      },
      detachForegroundWait() {
        return true;
      },
      markJobReported() {},
      onJobsChanged() {
        return () => {};
      },
      async dispose() {},
    };
    const bash = createBashTools(shell).find((t) => t.name === "bash")!;
    const out = await bash.execute({ command: "false" });
    expect(out.content).toBe("hi\n[exit code: 2]");
    expect(out.isError).toBeUndefined();
    expect(bash.presentCall?.({ command: "ls" })).toMatchObject({
      card: "terminal",
      title: "ls",
    });
  });
});
