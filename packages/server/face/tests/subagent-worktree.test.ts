import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSubagentWorktree,
  finalizeSubagentWorktree,
  resolveRepoRoot,
  worktreeSkippedForRemote,
} from "../src/subagent-worktree.js";

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" },
  });
}

function repo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xrk-wt-"));
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "t"]);
  writeFileSync(path.join(dir, "README.md"), "hi\n", "utf8");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-m", "init"]);
  return dir;
}

describe("subagent worktree", () => {
  it("skips remote terminals and non-git directories", () => {
    expect(worktreeSkippedForRemote(true)).toBe(true);
    expect(worktreeSkippedForRemote(undefined)).toBe(false);
    const empty = mkdtempSync(path.join(tmpdir(), "xrk-nogit-"));
    expect(resolveRepoRoot(empty)).toBeNull();
    expect(createSubagentWorktree(empty, "child")).toBeNull();
  });

  it("prunes a clean zero-commit worktree and keeps a dirty one", () => {
    const root = repo();
    const clean = createSubagentWorktree(root, "clean-1");
    expect(clean).not.toBeNull();
    expect(clean!.branch).toBe("xrk-subagent/subagent-clean-1");
    expect(existsSync(clean!.path)).toBe(true);
    const pruned = finalizeSubagentWorktree(clean!);
    expect(pruned.commits).toBe(0);
    expect(pruned.dirty).toBe(false);
    expect(pruned.pruned).toBe(true);
    expect(existsSync(clean!.path)).toBe(false);

    const dirty = createSubagentWorktree(root, "dirty-1");
    expect(dirty).not.toBeNull();
    writeFileSync(path.join(dirty!.path, "note.txt"), "keep\n", "utf8");
    const kept = finalizeSubagentWorktree(dirty!);
    expect(kept.dirty).toBe(true);
    expect(kept.pruned).toBe(false);
    expect(existsSync(dirty!.path)).toBe(true);

    const committed = createSubagentWorktree(root, "commit-1");
    expect(committed).not.toBeNull();
    writeFileSync(path.join(committed!.path, "done.txt"), "yes\n", "utf8");
    git(committed!.path, ["add", "done.txt"]);
    git(committed!.path, ["commit", "-m", "child"]);
    const stayed = finalizeSubagentWorktree(committed!);
    expect(stayed.commits).toBe(1);
    expect(stayed.pruned).toBe(false);
    expect(existsSync(committed!.path)).toBe(true);
  });

  it("keeps the worktree when commit inspection fails", () => {
    const info = {
      path: mkdtempSync(path.join(tmpdir(), "xrk-wt-keep-")),
      branch: "xrk-subagent/subagent-x",
      repoRoot: mkdtempSync(path.join(tmpdir(), "xrk-wt-root-")),
      baseCommit: "abc",
    };
    const result = finalizeSubagentWorktree(info, {
      git: () => ({ code: 1, stdout: "", stderr: "boom" }),
    });
    expect(result.pruned).toBe(false);
    expect(result.inspection_failed).toBe(true);
    expect(result.note).toMatch(/UNKNOWN/);
    expect(existsSync(info.path)).toBe(true);
  });
});
