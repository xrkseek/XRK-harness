import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSessionWorktree } from "../src/session-worktree.js";

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
}

function repo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xrk-swt-"));
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "t"]);
  writeFileSync(path.join(dir, "README.md"), "hi\n", "utf8");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-m", "init"]);
  return dir;
}

describe("createSessionWorktree", () => {
  it("creates branch + checkout under .xrk/worktrees without changing caller cwd", () => {
    const root = repo();
    const out = createSessionWorktree(root, { name: "feat-a" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.branch).toBe("feat-a");
    expect(out.value.path).toBe(path.join(root, ".xrk", "worktrees", "feat-a"));
    expect(existsSync(path.join(out.value.path, "README.md"))).toBe(true);
    expect(existsSync(path.join(root, ".xrk", "worktrees", ".gitignore"))).toBe(
      true,
    );
  });

  it("rejects duplicate branch names", () => {
    const root = repo();
    expect(createSessionWorktree(root, { name: "dup" }).ok).toBe(true);
    const again = createSessionWorktree(root, { name: "dup" });
    expect(again.ok).toBe(false);
  });
});
