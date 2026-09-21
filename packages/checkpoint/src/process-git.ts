import { spawn } from "node:child_process";
import type { GitResult, GitRunner } from "./types.js";

const STDIO_CAP = 4_000_000;

/**
 * Default git runner: spawn git, capture stdout/stderr, never inherit stdio.
 * A missing binary resolves `{ code: -1 }` (rather than rejecting) so the
 * store can raise its own typed `git-unavailable` error.
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
      child.on("error", (err) => {
        resolve({ code: -1, stdout, stderr: stderr || String(err) });
      });
      child.on("close", (code) => {
        resolve({ code: code ?? -1, stdout, stderr });
      });
    });
}
