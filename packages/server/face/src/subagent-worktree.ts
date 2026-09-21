/**
 * Optional git worktree per subagent.
 * Skipped outside a git repo and when the terminal is not local (SSH / remote).
 * Prune only when the child made zero commits and the tree is clean.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const GIT_TIMEOUT_MS = 30_000;

export interface SubagentWorktree {
  readonly path: string;
  readonly branch: string;
  readonly repoRoot: string;
  readonly baseCommit: string;
}

export interface SubagentWorktreeResult {
  path: string;
  branch: string;
  commits: number;
  dirty: boolean;
  pruned: boolean;
  inspection_failed?: boolean;
  note?: string;
}

export interface GitRunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type GitRunner = (args: readonly string[], cwd: string) => GitRunResult;

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_CONFIG_NOSYSTEM = "1";
  delete env.GIT_CONFIG_PARAMETERS;
  return env;
}

export function runGit(args: readonly string[], cwd: string): GitRunResult {
  const result = spawnSync("git", ["-c", "core.hooksPath=", ...args], {
    cwd,
    env: gitEnv(),
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.error ? result.error.message : (result.stderr ?? ""),
  };
}

/** Remote execution hides a host worktree from the child's terminal. */
export function worktreeSkippedForRemote(remoteExecution: boolean | undefined): boolean {
  return remoteExecution === true;
}

export function resolveRepoRoot(
  parentCwd: string,
  git: GitRunner = runGit,
): string | null {
  const candidate = path.resolve(parentCwd);
  if (!existsSync(candidate)) return null;
  const result = git(["rev-parse", "--show-toplevel"], candidate);
  if (result.code !== 0) return null;
  const root = result.stdout.trim();
  return root || null;
}

function ensureGitignore(repoRoot: string): void {
  const file = path.join(repoRoot, ".gitignore");
  try {
    const existing = existsSync(file)
      ? readFileSync(file, "utf8").replace(/^\uFEFF/, "")
      : "";
    if (existing.split(/\r?\n/).includes(".worktrees/")) return;
    const sep = existing && !existing.endsWith("\n") ? "\n" : "";
    appendFileSync(file, `${sep}.worktrees/\n`, "utf8");
  } catch {
    /* isolation still works if gitignore cannot be updated */
  }
}

export function createSubagentWorktree(
  parentCwd: string,
  subagentId?: string,
  git: GitRunner = runGit,
): SubagentWorktree | null {
  const repoRoot = resolveRepoRoot(parentCwd, git);
  if (!repoRoot) return null;
  const raw = (subagentId || randomUUID().replace(/-/g, "").slice(0, 8)).replace(
    /[\\/]/g,
    "-",
  );
  const wtName = raw.startsWith("subagent-") ? raw : `subagent-${raw}`;
  const branch = `xrk-subagent/${wtName}`;
  const wtPath = path.join(repoRoot, ".worktrees", wtName);
  try {
    mkdirSync(path.dirname(wtPath), { recursive: true });
    ensureGitignore(repoRoot);
    const base = git(["rev-parse", "HEAD"], repoRoot);
    if (base.code !== 0 || !base.stdout.trim()) return null;
    const added = git(
      ["worktree", "add", wtPath, "-b", branch, "HEAD"],
      repoRoot,
    );
    if (added.code !== 0) return null;
    return {
      path: wtPath,
      branch,
      repoRoot,
      baseCommit: base.stdout.trim(),
    };
  } catch {
    return null;
  }
}

function unproven(
  payload: SubagentWorktreeResult,
  reason: string,
  unmeasured = "commits/dirty",
): SubagentWorktreeResult {
  payload.inspection_failed = true;
  payload.note =
    `git inspection failed (${reason}): ${unmeasured} UNKNOWN — not proven zero/clean. ` +
    `The worktree and branch were preserved — inspect ${payload.path} (branch ${payload.branch}) before assuming no work.`;
  return payload;
}

export function finalizeSubagentWorktree(
  info: SubagentWorktree,
  options: { prune?: boolean; git?: GitRunner } = {},
): SubagentWorktreeResult {
  const prune = options.prune !== false;
  const git = options.git ?? runGit;
  const payload: SubagentWorktreeResult = {
    path: info.path,
    branch: info.branch,
    commits: 0,
    dirty: false,
    pruned: false,
  };
  if (!info.path || !existsSync(info.path)) {
    payload.pruned = true;
    return payload;
  }
  if (!info.baseCommit) {
    return unproven(payload, "no base_commit recorded — commit count unmeasurable", "commits");
  }
  const failed: string[] = [];
  const unmeasured: string[] = [];
  try {
    const commits = git(
      ["rev-list", "--count", `${info.baseCommit}..HEAD`],
      info.path,
    );
    if (commits.code === 0) {
      payload.commits = Number.parseInt(commits.stdout.trim() || "0", 10);
      if (!Number.isFinite(payload.commits)) {
        return unproven(payload, "rev-list count was not a number");
      }
    } else {
      failed.push(`rev-list exit ${commits.code}: ${commits.stderr.trim().slice(0, 200)}`);
      unmeasured.push("commits");
    }
    const status = git(["status", "--porcelain"], info.path);
    if (status.code === 0) {
      payload.dirty = status.stdout.trim().length > 0;
    } else {
      failed.push(`status exit ${status.code}: ${status.stderr.trim().slice(0, 200)}`);
      unmeasured.push("dirty");
    }
  } catch (err) {
    return unproven(payload, `inspection raised: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (failed.length) {
    return unproven(payload, failed.join("; "), unmeasured.join("/"));
  }
  if (prune && payload.commits === 0 && !payload.dirty) {
    const removed = git(["worktree", "remove", "--force", info.path], info.repoRoot);
    if (removed.code === 0) {
      git(["branch", "-D", info.branch], info.repoRoot);
      payload.pruned = true;
    }
  }
  return payload;
}

export function worktreeContextNote(info: SubagentWorktree): string {
  return (
    "[WORKTREE ISOLATION] You are working in an isolated git worktree " +
    `at: ${info.path}\n` +
    `Your dedicated branch is: ${info.branch}\n` +
    "All file edits and shell commands must happen inside this worktree directory. " +
    "Do NOT cd to the main repository checkout. Commit your changes to your branch when done. " +
    "If you make no commits and leave the tree clean, the worktree is discarded automatically."
  );
}

export function formatWorktreeResult(result: SubagentWorktreeResult): string {
  const bits = [
    `[worktree] ${result.path}`,
    `branch ${result.branch}`,
    `commits=${result.commits}`,
    `dirty=${result.dirty}`,
    `pruned=${result.pruned}`,
  ];
  if (result.note) bits.push(result.note);
  return bits.join("\n");
}
