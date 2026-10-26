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

/** Git output as text, for assertions that need a path or a message. */
function gitOut(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  }).trim();
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

describe("managed worktree reconcile + divergence diagnosis", () => {
  it("marks a lease lost once its checkout is gone, keeping branch and base", () => {
    const root = repo();
    const persist = path.join(
      mkdtempSync(path.join(tmpdir(), "xrk-mwt-persist-")),
      "managed-worktrees.json",
    );
    const manager = new ManagedWorktreeManager(persist);
    const lease = manager.allocate({
      parentCwd: root,
      parentSessionId: "p",
      subagentId: "gone",
    })!;
    git(root, ["worktree", "remove", "--force", lease.path]);
    expect(existsSync(lease.path)).toBe(false);

    const report = manager.reconcile({ now: 4242 });
    expect(report).toMatchObject({ checked: 1, lost: 1 });
    const after = manager.get(lease.id)!;
    expect(after.status).toBe("lost");
    expect(after.lost).toMatchObject({
      reason: "checkout-missing",
      checkedAt: 4242,
    });
    // Audit trail survives: the row still names the branch nobody merged.
    expect(after.branch).toBe(lease.branch);
    expect(after.baseCommit).toBe(lease.baseCommit);

    // Persisted, so a restart does not resurrect the dead lease as active.
    expect(new ManagedWorktreeManager(persist).get(lease.id)?.status).toBe("lost");
    // A second pass has nothing to do.
    expect(manager.reconcile().lost).toBe(0);
  });

  it("marks a lease lost when the branch behind a live checkout is gone", () => {
    const root = repo();
    const detached = path.join(
      mkdtempSync(path.join(tmpdir(), "xrk-mwt-detach-")),
      "wt",
    );
    git(root, ["worktree", "add", "--detach", detached, "HEAD"]);
    const persist = path.join(
      mkdtempSync(path.join(tmpdir(), "xrk-mwt-persist-")),
      "managed-worktrees.json",
    );
    writeFileSync(
      persist,
      JSON.stringify({
        leases: [
          {
            id: "ghost",
            path: detached,
            branch: "never-existed",
            repoRoot: root,
            baseCommit: "deadbeef",
            parentSessionId: "p",
            createdAt: 0,
            status: "active",
          },
        ],
      }),
      "utf8",
    );
    const report = new ManagedWorktreeManager(persist).reconcile();
    expect(report.lost).toBe(1);
    expect(
      new ManagedWorktreeManager(persist).get("ghost")?.lost?.reason,
    ).toBe("branch-missing");
  });

  it("leaves healthy and already-reclaimed leases alone", () => {
    const root = repo();
    const manager = new ManagedWorktreeManager();
    const live = manager.allocate({
      parentCwd: root,
      parentSessionId: "p",
      subagentId: "live",
    })!;
    const done = manager.allocate({
      parentCwd: root,
      parentSessionId: "p",
      subagentId: "done",
    })!;
    manager.reclaim(done.id);
    expect(done.id).not.toBe(live.id);

    const report = manager.reconcile();
    expect(report).toMatchObject({ checked: 1, lost: 0 });
    expect(manager.get(live.id)?.status).toBe("active");
    expect(manager.get(done.id)?.status).toBe("reclaimed");
  });

  it("reports ahead/behind when ff-only cannot fold a diverged branch", () => {
    const root = repo();
    const manager = new ManagedWorktreeManager();
    const lease = manager.allocate({
      parentCwd: root,
      parentSessionId: "p",
      subagentId: "diverge",
    })!;
    writeFileSync(path.join(lease.path, "child.txt"), "child\n", "utf8");
    git(lease.path, ["add", "child.txt"]);
    git(lease.path, ["commit", "-m", "child"]);
    writeFileSync(path.join(root, "parent.txt"), "parent\n", "utf8");
    git(root, ["add", "parent.txt"]);
    git(root, ["commit", "-m", "parent"]);

    const merged = manager.mergeIntoParent(lease.id);
    expect(merged).toMatchObject({
      ok: false,
      merged: false,
      ahead: 1,
      behind: 1,
    });
    expect(merged?.reason).toMatch(/1 ahead/);
    expect(manager.get(lease.id)?.status).toBe("active");
  });

  it("rebase-ff replays a diverged branch and then fast-forwards", () => {
    const root = repo();
    const manager = new ManagedWorktreeManager();
    const lease = manager.allocate({
      parentCwd: root,
      parentSessionId: "p",
      subagentId: "rebase-me",
    })!;
    writeFileSync(path.join(lease.path, "child.txt"), "child\n", "utf8");
    git(lease.path, ["add", "child.txt"]);
    git(lease.path, ["commit", "-m", "child"]);
    writeFileSync(path.join(root, "parent.txt"), "parent\n", "utf8");
    git(root, ["add", "parent.txt"]);
    git(root, ["commit", "-m", "parent"]);

    const merged = manager.mergeIntoParent(lease.id, {
      strategy: "rebase-ff",
      pruneAfter: true,
    });
    expect(merged, JSON.stringify(merged)).toMatchObject({
      ok: true,
      merged: true,
      rebased: true,
    });
    // Both sides of the history land in the parent, linearly.
    expect(existsSync(path.join(root, "child.txt"))).toBe(true);
    expect(existsSync(path.join(root, "parent.txt"))).toBe(true);
    expect(gitOut(root, ["rev-list", "--merges", "--count", "HEAD"])).toBe("0");
    expect(manager.get(lease.id)?.status).toBe("reclaimed");
  });

  it("rebase-ff aborts a conflicting replay and keeps the lease", () => {
    const root = repo();
    const manager = new ManagedWorktreeManager();
    const lease = manager.allocate({
      parentCwd: root,
      parentSessionId: "p",
      subagentId: "conflict",
    })!;
    writeFileSync(path.join(lease.path, "README.md"), "child version\n", "utf8");
    git(lease.path, ["add", "README.md"]);
    git(lease.path, ["commit", "-m", "child edit"]);
    writeFileSync(path.join(root, "README.md"), "parent version\n", "utf8");
    git(root, ["add", "README.md"]);
    git(root, ["commit", "-m", "parent edit"]);

    const merged = manager.mergeIntoParent(lease.id, { strategy: "rebase-ff" });
    expect(merged, JSON.stringify(merged)).toMatchObject({
      ok: false,
      merged: false,
    });
    expect(merged?.reason).toMatch(/rebase/);
    expect(manager.get(lease.id)?.status).toBe("active");
    // The abort left no rebase state behind: a later merge can still run.
    const rebaseDir = gitOut(lease.path, ["rev-parse", "--git-path", "rebase-merge"]);
    expect(existsSync(path.resolve(lease.path, rebaseDir))).toBe(false);
    expect(gitOut(lease.path, ["status", "--porcelain"])).toBe("");
  });
});
