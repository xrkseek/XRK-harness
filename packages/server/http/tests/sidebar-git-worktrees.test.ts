import { describe, expect, it } from "vitest";
import {
  parseWorktreeList,
  resolveGitWorktree,
  gitWorktrees,
} from "../src/sidebar/sidebar-git.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("parseWorktreeList", () => {
  it("parses porcelain records with spaces in checkout paths", () => {
    expect(
      parseWorktreeList(
        [
          "worktree C:/repo/main checkout",
          "HEAD abc",
          "branch refs/heads/main",
          "",
          "worktree C:/repo/agent checkout",
          "HEAD def",
          "detached",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      {
        path: "C:/repo/main checkout",
        branch: "main",
        locked: false,
        prunable: false,
      },
      {
        path: "C:/repo/agent checkout",
        branch: "HEAD",
        locked: false,
        prunable: false,
      },
    ]);
  });

  it("marks locked and prunable metadata", () => {
    expect(
      parseWorktreeList(
        [
          "worktree C:/repo/locked",
          "HEAD abc",
          "branch refs/heads/locked",
          "locked in use",
          "",
          "worktree C:/repo/missing",
          "HEAD def",
          "prunable gitdir file points to non-existent location",
          "",
        ].join("\0"),
      ),
    ).toEqual([
      {
        path: "C:/repo/locked",
        branch: "locked",
        locked: true,
        prunable: false,
      },
      {
        path: "C:/repo/missing",
        branch: "HEAD",
        locked: false,
        prunable: true,
      },
    ]);
  });
});

describe("gitWorktrees (live)", () => {
  it("lists the current checkout and fences unknown targets", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-sidebar-wt-"));
    try {
      try {
        execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
        execFileSync("git", ["config", "user.email", "t@xrk"], {
          cwd: root,
          stdio: "ignore",
        });
        execFileSync("git", ["config", "user.name", "xrk"], {
          cwd: root,
          stdio: "ignore",
        });
        writeFileSync(path.join(root, "tracked.txt"), "base\n");
        execFileSync("git", ["add", "tracked.txt"], {
          cwd: root,
          stdio: "ignore",
        });
        execFileSync("git", ["commit", "-m", "base"], {
          cwd: root,
          stdio: "ignore",
        });
      } catch {
        return;
      }
      const listed = gitWorktrees(root);
      expect(listed.length).toBeGreaterThanOrEqual(1);
      expect(listed.some((row) => row.current)).toBe(true);
      expect(() => resolveGitWorktree(root, root)).not.toThrow();
      expect(() =>
        resolveGitWorktree(root, path.join(root, "not-a-worktree")),
      ).toThrow(/unknown linked worktree/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
