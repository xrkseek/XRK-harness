/**
 * Main-session explicit worktree create (DSH experimental tool-worktree semantic).
 * Reuses {@link addLinkedWorktreeCheckout}; pool is `.xrk/worktrees/<name>`.
 * No Teams lease / merge registry — leave via working_directory.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  addLinkedWorktreeCheckout,
  resolveRepoRoot,
  runGit,
  type GitRunner,
} from "./subagent-worktree.js";

export interface CreateSessionWorktreeRequest {
  readonly name?: string;
  /** Local revision; omission selects HEAD. */
  readonly from?: string;
}

export interface CreatedSessionWorktree {
  readonly path: string;
  readonly branch: string;
  readonly baseCommit: string;
  readonly repositoryRoot: string;
}

export type CreateSessionWorktreeResult =
  | { readonly ok: true; readonly value: CreatedSessionWorktree }
  | { readonly ok: false; readonly error: string };

function relativeBranchName(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("\\") &&
    !value.includes(":") &&
    value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

function ensurePoolGitignore(poolDir: string): void {
  mkdirSync(poolDir, { recursive: true });
  const ignore = path.join(poolDir, ".gitignore");
  if (existsSync(ignore)) return;
  writeFileSync(ignore, "*\n", "utf8");
}

/**
 * Create a new branch + linked checkout under `<repo>/.xrk/worktrees/<name>`.
 * Does not change session cwd — caller invokes setSessionWorkingDirectory.
 */
export function createSessionWorktree(
  sourceCwd: string,
  request: CreateSessionWorktreeRequest = {},
  git: GitRunner = runGit,
): CreateSessionWorktreeResult {
  const repoRoot = resolveRepoRoot(sourceCwd, git);
  if (!repoRoot) {
    return { ok: false, error: "not a git repository" };
  }
  const branch =
    request.name?.trim() ||
    `worktree-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  if (!relativeBranchName(branch) || branch.startsWith("-")) {
    return {
      ok: false,
      error: "worktree name must be a relative Git branch name",
    };
  }
  const revision = (request.from ?? "HEAD").trim();
  if (!revision) {
    return { ok: false, error: "from must name a local commit, branch, or tag" };
  }

  const fmt = git(["check-ref-format", `refs/heads/${branch}`], repoRoot);
  if (fmt.code !== 0) {
    return { ok: false, error: `invalid branch name: ${branch}` };
  }
  const existing = git(
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    repoRoot,
  );
  if (existing.code === 0) {
    return { ok: false, error: `worktree branch already exists: ${branch}` };
  }

  const base = git(
    ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`],
    repoRoot,
  );
  if (base.code !== 0 || !base.stdout.trim()) {
    return {
      ok: false,
      error: `could not resolve local revision: ${revision}`,
    };
  }
  const baseCommit = base.stdout.trim();

  const poolDir = path.join(repoRoot, ".xrk", "worktrees");
  const wtPath = path.join(poolDir, branch);
  if (existsSync(wtPath)) {
    return { ok: false, error: `worktree path already exists: ${wtPath}` };
  }

  try {
    ensurePoolGitignore(poolDir);
    const checked = addLinkedWorktreeCheckout(
      repoRoot,
      branch,
      wtPath,
      baseCommit,
      git,
    );
    if (!checked.ok) {
      return { ok: false, error: checked.error };
    }
    return {
      ok: true,
      value: {
        path: wtPath,
        branch,
        baseCommit,
        repositoryRoot: repoRoot,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: `Could not finish worktree ${branch} at ${wtPath}. ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
