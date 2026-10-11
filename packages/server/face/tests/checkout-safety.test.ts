/**
 * DSH checkout-safety: linked worktree reset must not run clean/smudge filters.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSessionWorktree } from "../src/session-worktree.js";
import { createSubagentWorktree } from "../src/subagent-worktree.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "core.hooksPath=", ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  }).trim();
}

/** Smudge that rewrites every blob to a sentinel line (cross-platform Node). */
function smudgeCommand(): string {
  return `node -e "process.stdout.write('filtered\\n')"`;
}

function repoWithFilter(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xrk-chk-safe-"));
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["config", "core.autocrlf", "false"]);
  writeFileSync(path.join(dir, "tracked.txt"), "initial\n", "utf8");
  writeFileSync(
    path.join(dir, ".gitattributes"),
    "*.txt filter=xrk-test -text\n",
    "utf8",
  );
  git(dir, ["add", ".gitattributes", "tracked.txt"]);
  git(dir, ["commit", "-m", "init"]);
  git(dir, ["config", "filter.xrk-test.smudge", smudgeCommand()]);
  git(dir, ["config", "filter.xrk-test.required", "true"]);
  return dir;
}

describe("linked worktree checkout safety", () => {
  it("createSessionWorktree keeps stored blob without running smudge", () => {
    const root = repoWithFilter();
    const ordinary = path.join(root, "ordinary");
    git(root, ["worktree", "add", "-b", "ordinary", ordinary]);
    expect(readFileSync(path.join(ordinary, "tracked.txt"), "utf8")).toBe(
      "filtered\n",
    );

    const out = createSessionWorktree(root, { name: "safe-sess" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(readFileSync(path.join(out.value.path, "tracked.txt"), "utf8")).toBe(
      "initial\n",
    );
    // Repo filter config must remain intact.
    expect(git(root, ["config", "--get", "filter.xrk-test.required"])).toBe(
      "true",
    );
  });

  it("createSubagentWorktree keeps stored blob without running smudge", () => {
    const root = repoWithFilter();
    const created = createSubagentWorktree(root, "safe-child");
    expect(created).not.toBeNull();
    expect(existsSync(created!.path)).toBe(true);
    expect(readFileSync(path.join(created!.path, "tracked.txt"), "utf8")).toBe(
      "initial\n",
    );
  });
});
