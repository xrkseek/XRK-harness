import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function makeShell(backend: "pwsh" | "cmd" = "pwsh") {
  return createLocalShell({
    subprocess: createLocalSubprocess(),
    maxConcurrentJobs: 8,
    ...(backend === "cmd" ? { backend: "cmd" as const } : {}),
  });
}

function bashTool(shell: ReturnType<typeof makeShell>, yieldMs: number) {
  return createBashTools(shell, { foregroundYieldMs: yieldMs }).find(
    (t) => t.name === "bash",
  )!;
}

function bashToolWithBudget(shell: ReturnType<typeof makeShell>, yieldMs: number, maxOutputBytes: number) {
  return createBashTools(shell, { foregroundYieldMs: yieldMs, maxOutputBytes }).find(
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

  it("keeps the stderr error head when over-budget output is truncated", async () => {
    // A real script file sidesteps cmd/pwsh quote-stripping so the error text
    // is deterministic. backend "cmd" keeps the invoke simple on win32.
    const dir = mkdtempSync(join(tmpdir(), "xrk-shell-budget-"));
    const scriptPath = join(dir, "noisy.js");
    writeFileSync(
      scriptPath,
      [
        "for(let i=0;i<2000;i++) console.log('pad-pad-pad-pad-pad');",
        "console.error('npm ERR! code E409');",
        "process.exit(1);",
      ].join("\n"),
    );
    const shell = makeShell("cmd");
    try {
      const bash = bashToolWithBudget(shell, 5_000, 180);
      // No quotes around the path: cmd.exe /c quote-replay mangles a quoted
      // absolute path into `cwd + "path"`. TEMP has no spaces, so bare works.
      const out = await bash.execute({ command: `node ${scriptPath}` });
      const content = String(out.content);
      expect(content).toContain("npm ERR! code E409");
      expect(content).toContain("[stderr]");
      expect(content).toContain("[output truncated]");
      expect(content).toContain("[exit code: 1]");
    } finally {
      await shell.dispose();
      rmSync(dir, { recursive: true, force: true });
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
      // POSIX timeout kills often have null exitCode → `[killed by signal: …]`.
      expect(content).toMatch(/\[exit code:|\[killed by signal:/);
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
