import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceCheckpointError,
  WorkspaceCheckpointStore,
  checkpointExcludePath,
  checkpointIndexPath,
  shadowGitDir,
  workspaceCheckpointDir,
  writeJsonFileAtomic,
  type GitResult,
  type GitRunner,
} from "../src/index.js";

const temps: string[] = [];

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(path.join(tmpdir(), "xrk-ckpt-home-"));
  temps.push(testHome);
  // Never touch the operator's real ~/.xrk: resolve an isolated home for the
  // whole test file so `workspaceCheckpointDir` defaults are sandboxed.
  vi.stubEnv("XRK_HOME", testHome);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const SUBCOMMANDS = [
  "init",
  "add",
  "commit",
  "rev-parse",
  "ls-files",
  "ls-tree",
  "checkout",
  "clean",
];

/** First git subcommand in argv (base flags never contain these words). */
function subcommandOf(args: readonly string[]): string | undefined {
  return args.find((arg) => SUBCOMMANDS.includes(arg));
}

function fakeGit(
  handler: (args: readonly string[], call: number) => Partial<GitResult> | undefined,
): { run: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
    const run: GitRunner = async (args) => {
    const captured = [...args];
    calls.push(captured);
    const out = handler(captured, calls.length) ?? {};
    return {
      code: out.code ?? 0,
      stdout: out.stdout ?? "",
      stderr: out.stderr ?? "",
      ...(out.timedOut !== undefined ? { timedOut: out.timedOut } : {}),
    };
  };
  return { run, calls };
}

function workspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xrk-ckpt-"));
  temps.push(dir);
  const ws = path.join(dir, "ws");
  mkdirSync(ws, { recursive: true });
  return ws;
}

describe("WorkspaceCheckpointStore.snapshot", () => {
  it("initializes the shadow repo, commits, and records the point", async () => {
    const ws = workspace();
    const { run, calls } = fakeGit((args) => {
      switch (subcommandOf(args)) {
        case "rev-parse":
          return { stdout: "sha-1\n" };
        case "ls-files":
          return { stdout: "a.txt\nb/c.txt\n" };
        default:
          return {};
      }
    });
    const store = new WorkspaceCheckpointStore({
      workspaceDir: ws,
      runGit: run,
      now: () => 1234,
    });
    const record = await store.snapshot({
      sessionId: "s1",
      seq: 3,
      label: "pre-edit",
    });

    expect(record).toEqual({
      id: "sha-1",
      sessionId: "s1",
      seq: 3,
      createdAt: 1234,
      label: "pre-edit",
      fileCount: 2,
    });
    expect(calls.map(subcommandOf)).toEqual([
      "init",
      "add",
      "commit",
      "rev-parse",
      "ls-files",
    ]);

    // The shadow git dir + workspace work tree are pinned on every command.
    const resolved = path.resolve(ws);
    expect(calls[0]?.[0]).toBe(
      `--git-dir=${shadowGitDir(workspaceCheckpointDir(resolved))}`,
    );
    expect(calls[0]?.[1]).toBe(`--work-tree=${resolved}`);
    expect(calls[0]).toContain("core.autocrlf=false");
    // Shadow repo must never spawn background auto-maintenance (repack/gc):
    // those balloon the pack files and hold the locks that a concurrent
    // snapshot `add`/`commit` blocks on.
    expect(calls[0]).toContain("maintenance.auto=false");
    // Shadow commits must not depend on the operator's git identity/config.
    expect(calls[0]).toContain("commit.gpgsign=false");
    expect(calls[0]).toContain("user.email=checkpoint@xrk.invalid");
    // The shadow dir is pinned out of staging (it lives in the worktree).
    expect(calls[0]).toContain(
      `core.excludesFile=${checkpointExcludePath(workspaceCheckpointDir(resolved))}`,
    );

    const commit = calls.find((call) => subcommandOf(call) === "commit");
    expect(commit).toContain("--allow-empty");
    expect(commit?.join(" ")).toContain("session=s1 seq=3 label=pre-edit");

    const cold = new WorkspaceCheckpointStore({ workspaceDir: ws, runGit: run });
    expect(cold.list()).toEqual([record]);
  });

  it("does not re-init the shadow repo on a second snapshot", async () => {
    const ws = workspace();
    const { run, calls } = fakeGit((args) =>
      subcommandOf(args) === "rev-parse" ? { stdout: "sha-1\n" } : { stdout: "" },
    );
    const store = new WorkspaceCheckpointStore({ workspaceDir: ws, runGit: run });
    await store.snapshot({ sessionId: "s", seq: 0 });
    calls.length = 0;
    await store.snapshot({ sessionId: "s", seq: 1 });
    expect(calls.map(subcommandOf)).toEqual(["add", "commit", "rev-parse", "ls-files"]);
  });

  it("validates arguments before touching git", async () => {
    const { run, calls } = fakeGit(() => ({}));
    const store = new WorkspaceCheckpointStore({
      workspaceDir: workspace(),
      runGit: run,
    });
    await expect(store.snapshot({ sessionId: "   ", seq: 1 })).rejects.toMatchObject({
      code: "bad-argument",
    });
    await expect(
      store.snapshot({ sessionId: "s", seq: Number.NaN }),
    ).rejects.toMatchObject({ code: "bad-argument" });
    expect(calls).toHaveLength(0);
  });

  it("reports git-unavailable when the runner cannot start git", async () => {
    const { run } = fakeGit(() => ({ code: -1, stderr: "spawn git ENOENT" }));
    const store = new WorkspaceCheckpointStore({
      workspaceDir: workspace(),
      runGit: run,
    });
    await expect(store.snapshot({ sessionId: "s", seq: 0 })).rejects.toMatchObject({
      code: "git-unavailable",
    });
  });

  it("fails the snapshot and records nothing when commit fails", async () => {
    const { run } = fakeGit((args) =>
      subcommandOf(args) === "commit"
        ? { code: 128, stderr: "fatal: unable to write object" }
        : {},
    );
    const store = new WorkspaceCheckpointStore({
      workspaceDir: workspace(),
      runGit: run,
    });
    await expect(store.snapshot({ sessionId: "s", seq: 0 })).rejects.toThrow(
      /unable to write object/,
    );
    expect(store.list()).toEqual([]);
  });

  it("maps a runner timeout to a timed-out error instead of hanging", async () => {
    const { run } = fakeGit((args) =>
      subcommandOf(args) === "add" ? { code: -1, timedOut: true } : {},
    );
    const store = new WorkspaceCheckpointStore({
      workspaceDir: workspace(),
      runGit: run,
    });
    await expect(store.snapshot({ sessionId: "s", seq: 0 })).rejects.toMatchObject({
      code: "timed-out",
    });
    expect(store.list()).toEqual([]);
  });

  it("passes the timeout budget to the git runner on every command", async () => {
    const ws = workspace();
    const seen: (number | undefined)[] = [];
    const run: GitRunner = async (args, opts) => {
      seen.push(opts?.timeoutMs);
      if (subcommandOf(args) === "rev-parse") return { code: 0, stdout: "sha\n", stderr: "" };
      if (subcommandOf(args) === "ls-files") return { code: 0, stdout: "a\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    };
    const store = new WorkspaceCheckpointStore({ workspaceDir: ws, runGit: run, timeoutMs: 777 });
    await store.snapshot({ sessionId: "s", seq: 0 });
    expect(seen.length).toBeGreaterThan(0);
    // The whole-operation budget is decremented per command, so values are
    // ≤ the configured budget (and the first command gets the full amount).
    expect(seen[0]).toBe(777);
    for (const budget of seen) {
      expect(budget).toBeGreaterThanOrEqual(1);
      expect(budget).toBeLessThanOrEqual(777);
    }
  });
});

describe("WorkspaceCheckpointStore.planRestore", () => {
  it("reports the snapshot file count and the files it does not know about", async () => {
    const ws = workspace();
    const { run, calls } = fakeGit((args) => {
      switch (subcommandOf(args)) {
        case "rev-parse":
          return { stdout: "sha-1\n" };
        case "ls-files":
          return { stdout: "a.txt\n" };
        case "ls-tree":
          return { stdout: "a.txt\nb/c.txt\n" };
        case "clean":
          return { stdout: "Would remove scratch/new.txt\nWould remove tmp\n" };
        default:
          return {};
      }
    });
    const store = new WorkspaceCheckpointStore({ workspaceDir: ws, runGit: run });
    await store.snapshot({ sessionId: "s1", seq: 1 });
    calls.length = 0;

    const plan = await store.planRestore("sha-1");
    expect(plan).toEqual({
      id: "sha-1",
      fileCount: 2,
      extra: ["scratch/new.txt", "tmp"],
    });
    // Planning is a dry run: `clean` must not delete anything.
    const clean = calls.find((call) => subcommandOf(call) === "clean");
    expect(clean).toContain("-nd");
    expect(clean).not.toContain("-fd");
  });

  it("rejects an unknown checkpoint id", async () => {
    const { run } = fakeGit(() => ({}));
    const store = new WorkspaceCheckpointStore({
      workspaceDir: workspace(),
      runGit: run,
    });
    await expect(store.planRestore("nope")).rejects.toMatchObject({
      code: "unknown-checkpoint",
    });
    expect(() => store.get("nope")).toThrow(WorkspaceCheckpointError);
  });

  it("treats a missing shadow repo as an unknown checkpoint", async () => {
    const ws = workspace();
    const shadow = workspaceCheckpointDir(ws);
    writeJsonFileAtomic(checkpointIndexPath(shadow), {
      version: 1,
      records: [{ id: "sha-x", sessionId: "s", seq: 0, createdAt: 0, fileCount: 0 }],
    });
    const { run } = fakeGit(() => ({}));
    const store = new WorkspaceCheckpointStore({ workspaceDir: ws, runGit: run });
    expect(store.list()).toHaveLength(1);
    await expect(store.restore("sha-x")).rejects.toMatchObject({
      code: "unknown-checkpoint",
    });
  });
});

describe("WorkspaceCheckpointStore.restore", () => {
  function restoreFixture(cleanHandler?: (args: readonly string[]) => string) {
    const ws = workspace();
    const { run, calls } = fakeGit((args) => {
      switch (subcommandOf(args)) {
        case "rev-parse":
          return { stdout: "sha-1\n" };
        case "ls-files":
          return { stdout: "a.txt\n" };
        case "ls-tree":
          return { stdout: "a.txt\n" };
        case "clean":
          return {
            stdout: cleanHandler ? cleanHandler(args) : "Would remove new.txt\n",
          };
        default:
          return {};
      }
    });
    const store = new WorkspaceCheckpointStore({ workspaceDir: ws, runGit: run });
    return { ws, store, calls };
  }

  it("checks the snapshot out and keeps files it does not know about", async () => {
    const { store, calls } = restoreFixture();
    await store.snapshot({ sessionId: "s1", seq: 1 });
    calls.length = 0;

    const result = await store.restore("sha-1");
    expect(result).toEqual({
      id: "sha-1",
      fileCount: 1,
      extra: ["new.txt"],
      restored: 1,
      removed: [],
    });
    expect(calls.map(subcommandOf)).toEqual(["ls-tree", "clean", "checkout"]);
    const checkout = calls.find((call) => subcommandOf(call) === "checkout");
    expect(checkout).toEqual(
      expect.arrayContaining(["checkout", "--force", "sha-1", "--", "."]),
    );
    expect(calls.some((call) => call.includes("-fd"))).toBe(false);
  });

  it("deletes leftover files only when prune is requested", async () => {
    const { store, calls } = restoreFixture((args) =>
      args.includes("-nd") ? "Would remove new.txt\n" : "Removing new.txt\n",
    );
    await store.snapshot({ sessionId: "s1", seq: 1 });
    calls.length = 0;

    const result = await store.restore("sha-1", { prune: true });
    expect(result.removed).toEqual(["new.txt"]);
    expect(result.extra).toEqual(["new.txt"]);
    const cleans = calls.filter((call) => subcommandOf(call) === "clean");
    expect(cleans).toHaveLength(2);
    expect(cleans[0]).toContain("-nd");
    expect(cleans[1]).toContain("-fd");
  });

  it("fails the restore when checkout fails", async () => {
    const ws = workspace();
    let failCheckout = false;
    const { run } = fakeGit((args) => {
      switch (subcommandOf(args)) {
        case "rev-parse":
          return { stdout: "sha-1\n" };
        case "ls-files":
          return { stdout: "a.txt\n" };
        case "ls-tree":
          return { stdout: "a.txt\n" };
        case "checkout":
          return failCheckout
            ? { code: 1, stderr: "error: pathspec '.' did not match" }
            : {};
        default:
          return {};
      }
    });
    const store = new WorkspaceCheckpointStore({ workspaceDir: ws, runGit: run });
    await store.snapshot({ sessionId: "s1", seq: 1 });
    failCheckout = true;
    await expect(store.restore("sha-1")).rejects.toMatchObject({
      code: "restore-failed",
    });
    await expect(store.restore("sha-1")).rejects.toThrow(/pathspec/);
  });
});

describe("WorkspaceCheckpointStore.prune", () => {
  it("drops the oldest index records and keeps the newest", async () => {
    const ws = workspace();
    let revs = 0;
    const { run } = fakeGit((args) => {
      switch (subcommandOf(args)) {
        case "rev-parse":
          revs += 1;
          return { stdout: `sha-${revs}\n` };
        case "ls-files":
          return { stdout: "a.txt\n" };
        default:
          return {};
      }
    });
    const store = new WorkspaceCheckpointStore({ workspaceDir: ws, runGit: run });
    for (const seq of [1, 2, 3]) {
      await store.snapshot({ sessionId: "s", seq });
    }
    expect(store.list().map((r) => r.id)).toEqual(["sha-1", "sha-2", "sha-3"]);

    expect(store.prune(2)).toEqual(["sha-1"]);
    expect(store.list().map((r) => r.id)).toEqual(["sha-2", "sha-3"]);
    expect(store.prune(5)).toEqual([]);
    expect(() => store.prune(-1)).toThrow(WorkspaceCheckpointError);
    expect(() => store.prune(1.5)).toThrow(/non-negative integer/);

    const cold = new WorkspaceCheckpointStore({ workspaceDir: ws, runGit: run });
    expect(cold.list().map((r) => r.id)).toEqual(["sha-2", "sha-3"]);
  });
});

describe("WorkspaceCheckpointStore index loading", () => {
  it("ignores a corrupt index and invalid records", () => {
    const ws = workspace();
    const shadow = workspaceCheckpointDir(ws);
    mkdirSync(shadow, { recursive: true });
    writeFileSync(checkpointIndexPath(shadow), "{not json", "utf8");
    const { run } = fakeGit(() => ({}));
    expect(
      new WorkspaceCheckpointStore({ workspaceDir: ws, runGit: run }).list(),
    ).toEqual([]);

    writeJsonFileAtomic(checkpointIndexPath(shadow), {
      version: 1,
      records: [
        { id: "" },
        { id: "sha-ok", sessionId: "s", seq: 2, createdAt: 5, fileCount: 1 },
      ],
    });
    const reloaded = new WorkspaceCheckpointStore({ workspaceDir: ws, runGit: run });
    expect(reloaded.list().map((r) => r.id)).toEqual(["sha-ok"]);
  });

  it("computes a stable workspace id and derives the shadow paths", () => {
    const ws = workspace();
    const a = new WorkspaceCheckpointStore({
      workspaceDir: ws,
      runGit: fakeGit(() => ({})).run,
    });
    const b = new WorkspaceCheckpointStore({
      workspaceDir: ws,
      runGit: fakeGit(() => ({})).run,
    });
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^[0-9a-f]{12}$/);
    expect(a.shadowDir).toBe(workspaceCheckpointDir(ws));
    expect(a.excludesFile).toBe(checkpointExcludePath(a.shadowDir));

    // A shadow dir outside the workspace needs no self-exclude pattern.
    const outside = path.join(ws, "..", "outside-shadow");
    const c = new WorkspaceCheckpointStore({
      workspaceDir: ws,
      shadowDir: outside,
      runGit: fakeGit(() => ({})).run,
    });
    expect(c.shadowDir).toBe(path.resolve(outside));
  });
});
