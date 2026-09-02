import { describe, expect, it } from "vitest";
import {
  createBashTools,
  createLocalShell,
} from "../src/index.js";
import { createLocalSubprocess } from "@xrkseek/exec-subprocess";

const NODE = process.execPath;
// pwsh needs the call operator for a quoted command path (`'exe' -e …` parses
// as an expression); POSIX shells accept the quoted path directly. Single
// quotes keep the JS payload verbatim through -Command.
const NODE_CMD =
  process.platform === "win32" ? `& '${NODE}'` : `'${NODE}'`;
const BLOCK = `${NODE_CMD} -e 'setTimeout(()=>{},30000)'`;
const FAST = `${NODE_CMD} -e 'console.log("hi")'`;
// Shell-native exit: a native child's code does not always propagate through
// the pwsh -Command wrapper, but the shell's own exit status always does.
const FAIL = "exit 3";

function makeShell() {
  return createLocalShell({
    subprocess: createLocalSubprocess(),
    maxConcurrentJobs: 8,
  });
}

function bashTool(shell: ReturnType<typeof makeShell>, yieldMs: number) {
  return createBashTools(shell, { foregroundYieldMs: yieldMs }).find(
    (t) => t.name === "bash",
  )!;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("bash foreground yield semantics", () => {
  it("settles inside the yield with legacy markers", async () => {
    const shell = makeShell();
    try {
      const bash = bashTool(shell, 5_000);
      const out = await bash.execute({ command: FAST });
      expect(String(out.content)).toContain("hi");
      expect(String(out.content)).not.toContain("still running");

      const failed = await bash.execute({ command: FAIL });
      expect(String(failed.content)).toContain("[exit code: 3]");
      expect(failed.isError).toBeUndefined();
    } finally {
      await shell.dispose();
    }
  });

  it("yields a still-running job instead of blocking the turn", async () => {
    const shell = makeShell();
    try {
      const bash = bashTool(shell, 400);
      const out = await bash.execute({ command: BLOCK });
      const content = String(out.content);
      expect(content).toContain("still running after 400 ms");
      const match = /job (bash-\d+)/.exec(content);
      expect(match).not.toBeNull();
      const id = match![1]!;
      // The process keeps running: the yield killed nothing.
      const live = shell.listJobsNow().find((j) => j.id === id);
      expect(live?.status).toBe("running");
      // Foreground wait was detached on return.
      expect(live?.foreground).toBeUndefined();
      expect(shell.detachForegroundWait(id)).toBe(false);

      await shell.killJob(id);
      await shell.waitJob(id, 5_000);
    } finally {
      await shell.dispose();
    }
  });

  it("timeout_ms is a hard kill deadline", async () => {
    const shell = makeShell();
    try {
      const bash = bashTool(shell, 10_000);
      const started = Date.now();
      const out = await bash.execute({
        command: BLOCK,
        timeout_ms: 300,
      });
      expect(Date.now() - started).toBeLessThan(5_000);
      const content = String(out.content);
      expect(content).not.toContain("still running");
      // Settled foreground keeps the legacy shape: exit marker, no trailer.
      expect(content).toContain("[exit code:");
      const job = shell.listJobsNow().find((j) => j.command === BLOCK);
      expect(job?.status).toBe("killed");
    } finally {
      await shell.dispose();
    }
  });

  it("detach (UI move-to-background) ends the wait, not the process", async () => {
    const shell = makeShell();
    try {
      const bash = bashTool(shell, 30_000);
      const pending = bash.execute({ command: BLOCK });
      let id: string | undefined;
      for (let i = 0; i < 40 && id === undefined; i++) {
        await sleep(50);
        id = shell.listJobsNow().find((j) => j.foreground)?.id;
      }
      expect(id).toBeDefined();
      expect(shell.detachForegroundWait(id!)).toBe(true);

      const out = await pending;
      expect(String(out.content)).toContain("still running");
      const live = shell.listJobsNow().find((j) => j.id === id);
      expect(live?.status).toBe("running");

      await shell.killJob(id!);
      await shell.waitJob(id!, 5_000);
    } finally {
      await shell.dispose();
    }
  });

  it("turn abort still kills the process", async () => {
    const shell = makeShell();
    try {
      const bash = bashTool(shell, 30_000);
      const controller = new AbortController();
      const pending = bash.execute({ command: BLOCK }, controller.signal);
      let id: string | undefined;
      for (let i = 0; i < 40 && id === undefined; i++) {
        await sleep(50);
        id = shell.listJobsNow().find((j) => j.foreground)?.id;
      }
      expect(id).toBeDefined();
      controller.abort();
      const out = await pending;
      expect(String(out.content)).not.toContain("still running");
      await shell.waitJob(id!, 5_000);
      const settled = shell.listJobsNow().find((j) => j.id === id);
      expect(settled?.status).toBe("killed");
    } finally {
      await shell.dispose();
    }
  });
});
