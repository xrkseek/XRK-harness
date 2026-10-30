import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { GitResult, GitRunner } from "./types.js";

const STDIO_CAP = 4_000_000;

/**
 * Environment pinned for every git call.
 *
 * Two of these are load-bearing, not cosmetic:
 *
 * - `LC_ALL=C` / `LANG=C` / `LANGUAGE=en` — git localizes the prefixes the
 *   store parses (`Would remove ` from `clean -nd`, `Removing ` from
 *   `clean -fd`). On a Chinese Windows box git answers `将删除 …`, so a
 *   localized machine silently reported "no extra files" and `--prune`
 *   removed nothing. Pinning the locale makes the same command produce the
 *   same bytes on Windows, macOS and a minimal Linux container.
 * - `GIT_TERMINAL_PROMPT=0` — a background snapshot must never stop on a
 *   credential prompt. The shadow repo needs no network, but an inherited
 *   `credential.helper` can still ask.
 *
 * Also strips the inherited `GIT_*` repository overrides: a Host started from
 * a git hook / `git rebase` shell (or an IDE that exports them) would
 * otherwise let `GIT_OBJECT_DIRECTORY` / `GIT_INDEX_FILE` point the shadow
 * commands at the operator's repository. `--git-dir` wins over `GIT_DIR`, but
 * not over those.
 */
const GIT_ENV: Readonly<Record<string, string>> = {
  LC_ALL: "C",
  LANG: "C",
  LANGUAGE: "en",
  GIT_TERMINAL_PROMPT: "0",
};

const GIT_ENV_OVERRIDES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
  "GIT_CEILING_DIRECTORIES",
] as const;

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...GIT_ENV };
  for (const key of GIT_ENV_OVERRIDES) delete env[key];
  return env;
}

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
 *
 * Output is decoded with a streaming UTF-8 decoder: a multi-byte character
 * (any CJK path in `clean -nd` / `ls-files`) can straddle two chunks, and a
 * per-chunk `toString("utf8")` turns it into U+FFFD. Paths are compared and
 * printed, so a mangled name is a wrong name.
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
          env: gitEnv(),
        });
      } catch (err) {
        resolve({ code: -1, stdout: "", stderr: String(err) });
        return;
      }
      let stdout = "";
      let stderr = "";
      const outDecoder = new StringDecoder("utf8");
      const errDecoder = new StringDecoder("utf8");
      child.stdout?.on("data", (chunk: Buffer) => {
        if (stdout.length < STDIO_CAP) stdout += outDecoder.write(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < STDIO_CAP) stderr += errDecoder.write(chunk);
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
        // Flush a half-decoded tail (a truncated multi-byte sequence) so the
        // result never drops the last captured line.
        stdout += outDecoder.end();
        stderr += errDecoder.end();
        resolve({
          code: code ?? -1,
          stdout,
          stderr,
          ...(armed ? { timedOut } : {}),
        });
      });
    });
}
