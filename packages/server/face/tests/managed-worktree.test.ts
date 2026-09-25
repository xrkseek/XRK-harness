import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentTeamTaskBoard } from "../src/agent-team-tasks.js";
import {
  ManagedWorktreeManager,
  bindManagedWorktreeOwner,
  readManagedWorktreeOwner,
} from "../src/managed-worktree.js";

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
  const dir = mkdtempSync(path.join(tmpdir(), "xrk-mwt-"));
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "t"]);
  writeFileSync(path.join(dir, "README.md"), "hi\n", "utf8");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-m", "init"]);
  return dir;
}

describe("managed worktree allocate / reclaim / Teams bind", () => {
  it("allocates, binds owner metadata + Teams task, then reclaims clean trees", () => {
    const root = repo();
    const persist = path.join(
      mkdtempSync(path.join(tmpdir(), "xrk-mwt-persist-")),
      "managed-worktrees.json",
    );
    const manager = new ManagedWorktreeManager(persist);
    const board = new AgentTeamTaskBoard();

    const lease = manager.allocate({
      parentCwd: root,
      parentSessionId: "parent_1",
      subagentId: "child-a",
    });
    expect(lease).not.toBeNull();
    expect(existsSync(lease!.path)).toBe(true);
    expect(manager.list("parent_1")).toHaveLength(1);

    const task = board.open({
      parentSessionId: "parent_1",
      title: "isolated edit",
      childSessionId: "child_sess",
    });
    const bound = manager.bind(lease!.id, {
      childSessionId: "child_sess",
      teamTaskId: task.id,
    });
    expect(bound?.childSessionId).toBe("child_sess");
    expect(bound?.teamTaskId).toBe(task.id);

    const owner = readManagedWorktreeOwner(lease!.path);
    expect(owner?.ownerSessionId).toBe("child_sess");
    expect(owner?.teamTaskId).toBe(task.id);

    board.bindWorktree(task.id, {
      path: lease!.path,
      branch: lease!.branch,
      id: lease!.id,
    });
    expect(board.get(task.id)?.worktreePath).toBe(lease!.path);
    expect(board.get(task.id)?.worktreeBranch).toBe(lease!.branch);
    expect(manager.findByTask(task.id)?.id).toBe(lease!.id);
    expect(manager.findByChild("child_sess")?.id).toBe(lease!.id);

    const result = manager.reclaim(lease!.id);
    expect(result?.pruned).toBe(true);
    expect(manager.get(lease!.id)?.status).toBe("reclaimed");
    expect(existsSync(lease!.path)).toBe(false);

    // Sidecar survives for Status / restart audit.
    const reloaded = new ManagedWorktreeManager(persist);
    expect(reloaded.get(lease!.id)?.status).toBe("reclaimed");
  });

  it("refuses to rebind a worktree to a different owner", () => {
    const root = repo();
    const manager = new ManagedWorktreeManager();
    const lease = manager.allocate({
      parentCwd: root,
      parentSessionId: "p",
      subagentId: "own",
    });
    expect(lease).not.toBeNull();
    manager.bind(lease!.id, { childSessionId: "sess_a" });
    expect(() =>
      bindManagedWorktreeOwner(lease!.path, { ownerSessionId: "sess_b" }),
    ).toThrow(/already belongs/);
    // Same owner is idempotent.
    expect(
      bindManagedWorktreeOwner(lease!.path, { ownerSessionId: "sess_a" })
        .ownerSessionId,
    ).toBe("sess_a");
  });

  it("retains dirty worktrees and marks status retained", () => {
    const root = repo();
    const manager = new ManagedWorktreeManager();
    const lease = manager.allocate({
      parentCwd: root,
      parentSessionId: "p",
      subagentId: "dirty",
    });
    expect(lease).not.toBeNull();
    writeFileSync(path.join(lease!.path, "note.txt"), "keep\n", "utf8");
    const result = manager.reclaim(lease!.id);
    expect(result?.dirty).toBe(true);
    expect(result?.pruned).toBe(false);
    expect(manager.get(lease!.id)?.status).toBe("retained");
    expect(existsSync(lease!.path)).toBe(true);
  });

  it("mergeIntoParent ff-only folds child commits into the parent checkout", () => {
    const root = repo();
    const manager = new ManagedWorktreeManager();
    const lease = manager.allocate({
      parentCwd: root,
      parentSessionId: "p",
      subagentId: "merge-me",
    });
    expect(lease).not.toBeNull();
    writeFileSync(path.join(lease!.path, "feat.txt"), "from-child\n", "utf8");
    git(lease!.path, ["add", "feat.txt"]);
    git(lease!.path, ["commit", "-m", "child change"]);

    const merged = manager.mergeIntoParent(lease!.id, { pruneAfter: true });
    expect(merged, JSON.stringify(merged)).toMatchObject({
      ok: true,
      merged: true,
    });
    expect(existsSync(path.join(root, "feat.txt"))).toBe(true);
    expect(manager.get(lease!.id)?.status).toBe("reclaimed");
  });

  it("mergeIntoParent retains lease when parent is dirty (conflict UI signal)", () => {
    const root = repo();
    const manager = new ManagedWorktreeManager();
    const lease = manager.allocate({
      parentCwd: root,
      parentSessionId: "p",
      subagentId: "dirty-parent",
    });
    expect(lease).not.toBeNull();
    writeFileSync(path.join(lease!.path, "feat.txt"), "from-child\n", "utf8");
    git(lease!.path, ["add", "feat.txt"]);
    git(lease!.path, ["commit", "-m", "child change"]);
    writeFileSync(path.join(root, "dirty.txt"), "parent-dirty\n", "utf8");

    const merged = manager.mergeIntoParent(lease!.id);
    expect(merged?.ok).toBe(false);
    expect(merged?.merged).toBe(false);
    expect(merged?.reason).toMatch(/dirty/i);
    expect(manager.get(lease!.id)?.status).toBe("active");
  });
});
