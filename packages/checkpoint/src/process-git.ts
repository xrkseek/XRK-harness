import { spawn } from "node:child_process";
import type { GitResult, GitRunner } from "./types.js";

const STDIO_CAP = 4_000_000;

/**
 * Default git runner: spawn git, capture stdout/stderr, never inherit stdio.
 * A missing binary resolves `{ code: -1 }` (rather than rejecting) so the
 * store can raise its own typed `git-unavailable` error.
 *
 * `timeoutMs` (opt-in via {@link GitRunnerOptions}) arms a hard deadline:
 * the child is killed and the call resolves `{ code: -1, timedOut: true }`
 * (never rejects), so a hung git process — a shadow-repo repack holding the
 * object locks, antivirus scan, network fs stall — degrades to a typed
 * timeout instead of blocking the caller forever.
 */
export function createProcessGitRunner(gitPath = "git"): GitRunner {
  return (args, opts) =>
    new Promise<GitResult>((resolve) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(gitPath, [...args], {
          cwd: opts?.cwd,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (err) {
        resolve({ code: -1, stdout: "", stderr: String(err) });
        return;
      }
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        if (stdout.length < STDIO_CAP) stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < STDIO_CAP) stderr += chunk.toString("utf8");
      });
      const deadline = opts?.timeoutMs;
      const armed = deadline !== undefined && deadline > 0;
      let timedOut = false;
      if (armed) {
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, deadline);
        timer.unref();
        child.once("close", () => clearTimeout(timer));
      }
      child.on("error", (err) => {
        resolve({ code: -1, stdout, stderr: stderr || String(err) });
      });
      child.on("close", (code) => {
        resolve({
          code: code ?? -1,
          stdout,
          stderr,
          ...(armed ? { timedOut } : {}),
        });
      });
    });
}
