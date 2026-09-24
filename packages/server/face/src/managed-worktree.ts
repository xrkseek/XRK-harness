/**
 * Managed worktree registry — allocate / reclaim / owner metadata, bindable to
 * Agent Teams tasks. Builds on {@link createSubagentWorktree} /
 * {@link finalizeSubagentWorktree}; ownership record is Codex-inspired
 * (`codex-thread.json` → `xrk-managed-worktree.json`).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tryWriteJsonSidecar } from "./json-sidecar.js";
import {
  createSubagentWorktree,
  finalizeSubagentWorktree,
  type GitRunner,
  type SubagentWorktree,
  type SubagentWorktreeResult,
  runGit,
} from "./subagent-worktree.js";

export const MANAGED_WORKTREE_OWNER_VERSION = 1 as const;
export const MANAGED_WORKTREE_OWNER_FILENAME = "xrk-managed-worktree.json";

export type ManagedWorktreeStatus = "active" | "reclaimed" | "retained";

/**
 * How to fold a managed worktree branch back into the parent checkout.
 * Only `ff-only` is implemented (matches Codex “clean merge or keep retained”).
 * Conflict / diverged history → retain the lease; no auto conflict UI.
 */
export type ManagedWorktreeMergeStrategy = "ff-only";

export interface ManagedWorktreeMergeResult {
  readonly ok: boolean;
  readonly strategy: ManagedWorktreeMergeStrategy;
  readonly leaseId: string;
  readonly branch: string;
  readonly repoRoot: string;
  /** True when `git merge --ff-only` succeeded. */
  readonly merged: boolean;
  readonly reason?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  /** Present when `pruneAfter` ran after a successful merge. */
  readonly reclaim?: SubagentWorktreeResult;
}

/** Durable owner record written beside each checkout (git admin or `.xrk/`). */
export interface ManagedWorktreeOwnerRecord {
  readonly version: typeof MANAGED_WORKTREE_OWNER_VERSION;
  /** Child session that owns the checkout (Codex ownerThreadId analogue). */
  readonly ownerSessionId: string;
  readonly parentSessionId?: string;
  readonly teamTaskId?: string;
  readonly branch?: string;
  readonly baseCommit?: string;
  readonly boundAt: number;
}

export interface ManagedWorktreeLease {
  readonly id: string;
  readonly path: string;
  readonly branch: string;
  readonly repoRoot: string;
  readonly baseCommit: string;
  readonly parentSessionId: string;
  readonly createdAt: number;
  readonly status: ManagedWorktreeStatus;
  readonly childSessionId?: string;
  readonly teamTaskId?: string;
  readonly reclaim?: SubagentWorktreeResult;
}

interface PersistShape {
  readonly leases: ManagedWorktreeLease[];
}

function ownerFilePath(checkout: string, git: GitRunner = runGit): string {
  const resolved = git(
    ["rev-parse", "--git-path", MANAGED_WORKTREE_OWNER_FILENAME],
    checkout,
  );
  if (resolved.code === 0 && resolved.stdout.trim()) {
    const rel = resolved.stdout.trim().replace(/\//g, path.sep);
    return path.isAbsolute(rel) ? rel : path.join(checkout, rel);
  }
  return path.join(checkout, ".xrk", MANAGED_WORKTREE_OWNER_FILENAME);
}

/** Read owner metadata; `null` when missing or invalid. */
export function readManagedWorktreeOwner(
  checkout: string,
  git: GitRunner = runGit,
): ManagedWorktreeOwnerRecord | null {
  try {
    const file = ownerFilePath(checkout, git);
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, "utf8")) as ManagedWorktreeOwnerRecord;
    if (
      raw.version !== MANAGED_WORKTREE_OWNER_VERSION ||
      typeof raw.ownerSessionId !== "string" ||
      !raw.ownerSessionId.trim()
    ) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

/**
 * Bind ownership atomically. Re-binding the same owner is a no-op;
 * a different owner throws.
 */
export function bindManagedWorktreeOwner(
  checkout: string,
  record: Omit<ManagedWorktreeOwnerRecord, "version" | "boundAt"> & {
    readonly boundAt?: number;
  },
  git: GitRunner = runGit,
): ManagedWorktreeOwnerRecord {
  const ownerSessionId = record.ownerSessionId.trim();
  if (!ownerSessionId) {
    throw new Error("managed worktree ownerSessionId cannot be empty");
  }
  const existing = readManagedWorktreeOwner(checkout, git);
  if (existing) {
    if (existing.ownerSessionId === ownerSessionId) return existing;
    throw new Error(
      `worktree already belongs to session ${existing.ownerSessionId}`,
    );
  }
  const full: ManagedWorktreeOwnerRecord = {
    version: MANAGED_WORKTREE_OWNER_VERSION,
    ownerSessionId,
    boundAt: record.boundAt ?? Date.now(),
    ...(record.parentSessionId
      ? { parentSessionId: record.parentSessionId }
      : {}),
    ...(record.teamTaskId ? { teamTaskId: record.teamTaskId } : {}),
    ...(record.branch ? { branch: record.branch } : {}),
    ...(record.baseCommit ? { baseCommit: record.baseCommit } : {}),
  };
  const file = ownerFilePath(checkout, git);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(full, null, 2)}\n`, "utf8");
  try {
    renameSync(tmp, file);
  } catch (err) {
    const again = readManagedWorktreeOwner(checkout, git);
    if (again?.ownerSessionId === ownerSessionId) return again;
    throw err;
  }
  return full;
}

export function managedWorktreesPath(
  subagentPersistPath: string | undefined,
): string | undefined {
  if (!subagentPersistPath) return undefined;
  return path.join(path.dirname(subagentPersistPath), "managed-worktrees.json");
}

/** Face-scoped registry of managed worktree leases. */
export class ManagedWorktreeManager {
  private readonly leases = new Map<string, ManagedWorktreeLease>();
  private readonly persistPath: string | undefined;
  private readonly git: GitRunner;

  constructor(
    persistPath?: string,
    options: { readonly git?: GitRunner } = {},
  ) {
    this.persistPath = persistPath;
    this.git = options.git ?? runGit;
    if (persistPath) this.load();
  }

  get(id: string): ManagedWorktreeLease | undefined {
    return this.leases.get(id.trim());
  }

  list(parentSessionId?: string): readonly ManagedWorktreeLease[] {
    const parent = parentSessionId?.trim();
    return [...this.leases.values()]
      .filter((l) => (parent ? l.parentSessionId === parent : true))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  findByChild(childSessionId: string): ManagedWorktreeLease | undefined {
    const id = childSessionId.trim();
    for (const lease of this.leases.values()) {
      if (lease.childSessionId === id) return lease;
    }
    return undefined;
  }

  findByTask(teamTaskId: string): ManagedWorktreeLease | undefined {
    const id = teamTaskId.trim();
    for (const lease of this.leases.values()) {
      if (lease.teamTaskId === id) return lease;
    }
    return undefined;
  }

  /**
   * Allocate a git worktree and register an active lease (unbound until
   * {@link bind}).
   */
  allocate(input: {
    readonly parentCwd: string;
    readonly parentSessionId: string;
    readonly subagentId?: string;
    readonly now?: number;
  }): ManagedWorktreeLease | null {
    const created = createSubagentWorktree(
      input.parentCwd,
      input.subagentId,
      this.git,
    );
    if (!created) return null;
    const id = path.basename(created.path);
    const lease: ManagedWorktreeLease = {
      id,
      path: created.path,
      branch: created.branch,
      repoRoot: created.repoRoot,
      baseCommit: created.baseCommit,
      parentSessionId: input.parentSessionId.trim(),
      createdAt: input.now ?? Date.now(),
      status: "active",
    };
    this.leases.set(id, lease);
    this.save();
    return lease;
  }

  /** Bind lease to child session (+ optional Teams task) and write owner file. */
  bind(
    leaseId: string,
    input: {
      readonly childSessionId: string;
      readonly teamTaskId?: string;
      readonly now?: number;
    },
  ): ManagedWorktreeLease | undefined {
    const prev = this.leases.get(leaseId.trim());
    if (!prev || prev.status !== "active") return undefined;
    const childSessionId = input.childSessionId.trim();
    if (!childSessionId) return undefined;
    bindManagedWorktreeOwner(
      prev.path,
      {
        ownerSessionId: childSessionId,
        parentSessionId: prev.parentSessionId,
        ...(input.teamTaskId ? { teamTaskId: input.teamTaskId.trim() } : {}),
        branch: prev.branch,
        baseCommit: prev.baseCommit,
        ...(input.now !== undefined ? { boundAt: input.now } : {}),
      },
      this.git,
    );
    const next: ManagedWorktreeLease = {
      ...prev,
      childSessionId,
      ...(input.teamTaskId
        ? { teamTaskId: input.teamTaskId.trim() }
        : prev.teamTaskId
          ? { teamTaskId: prev.teamTaskId }
          : {}),
    };
    this.leases.set(prev.id, next);
    this.save();
    return next;
  }

  /**
   * Merge the lease branch into the parent repo's current HEAD (`ff-only`).
   * Editing in the child stays isolated (session cwd = worktree); this is the
   * explicit fold-back step — never runs on reclaim by default.
   * Diverged / dirty parent → `{ ok:false, merged:false }` and lease stays.
   */
  mergeIntoParent(
    leaseId: string,
    options: {
      readonly strategy?: ManagedWorktreeMergeStrategy;
      /** After a successful ff merge, reclaim (prune-if-clean). Default false. */
      readonly pruneAfter?: boolean;
    } = {},
  ): ManagedWorktreeMergeResult | undefined {
    const lease = this.leases.get(leaseId.trim());
    if (!lease) return undefined;
    const strategy = options.strategy ?? "ff-only";
    if (strategy !== "ff-only") {
      return {
        ok: false,
        strategy,
        leaseId: lease.id,
        branch: lease.branch,
        repoRoot: lease.repoRoot,
        merged: false,
        reason: `unsupported merge strategy: ${String(strategy)}`,
      };
    }

    const status = this.git(["status", "--porcelain"], lease.repoRoot);
    if (status.code !== 0) {
      return {
        ok: false,
        strategy,
        leaseId: lease.id,
        branch: lease.branch,
        repoRoot: lease.repoRoot,
        merged: false,
        reason: "could not inspect parent worktree status",
        stderr: status.stderr,
      };
    }
    if (status.stdout.trim()) {
      return {
        ok: false,
        strategy,
        leaseId: lease.id,
        branch: lease.branch,
        repoRoot: lease.repoRoot,
        merged: false,
        reason: "parent worktree is dirty — commit or stash before merge",
        stdout: status.stdout,
      };
    }

    const merged = this.git(
      ["merge", "--ff-only", lease.branch],
      lease.repoRoot,
    );
    if (merged.code !== 0) {
      return {
        ok: false,
        strategy,
        leaseId: lease.id,
        branch: lease.branch,
        repoRoot: lease.repoRoot,
        merged: false,
        reason:
          "ff-only merge failed (branch diverged or has no unique commits) — lease retained",
        stdout: merged.stdout,
        stderr: merged.stderr,
      };
    }

    let reclaim: SubagentWorktreeResult | undefined;
    if (options.pruneAfter) {
      // Commits already folded into parent — force-remove even when commits > 0.
      const removed = this.git(
        ["worktree", "remove", "--force", lease.path],
        lease.repoRoot,
      );
      const pruned = removed.code === 0;
      if (pruned) {
        this.git(["branch", "-D", lease.branch], lease.repoRoot);
      }
      reclaim = {
        path: lease.path,
        branch: lease.branch,
        commits: 0,
        dirty: false,
        pruned,
        ...(pruned
          ? {}
          : {
              note: `worktree remove failed after merge: ${removed.stderr.trim().slice(0, 200)}`,
            }),
      };
      const next: ManagedWorktreeLease = {
        ...lease,
        status: pruned ? "reclaimed" : "retained",
        reclaim,
      };
      this.leases.set(lease.id, next);
      this.save();
    }

    return {
      ok: true,
      strategy,
      leaseId: lease.id,
      branch: lease.branch,
      repoRoot: lease.repoRoot,
      merged: true,
      ...(reclaim ? { reclaim } : {}),
    };
  }

  /** Reclaim (prune-if-clean) and update lease status. */
  reclaim(
    leaseId: string,
    options: { readonly prune?: boolean } = {},
  ): SubagentWorktreeResult | undefined {
    const prev = this.leases.get(leaseId.trim());
    if (!prev) return undefined;
    const info: SubagentWorktree = {
      path: prev.path,
      branch: prev.branch,
      repoRoot: prev.repoRoot,
      baseCommit: prev.baseCommit,
    };
    const result = finalizeSubagentWorktree(info, {
      ...(options.prune !== undefined ? { prune: options.prune } : {}),
      git: this.git,
    });
    const next: ManagedWorktreeLease = {
      ...prev,
      status: result.pruned ? "reclaimed" : "retained",
      reclaim: result,
    };
    this.leases.set(prev.id, next);
    this.save();
    return result;
  }

  /** Convenience: reclaim by child session id. */
  reclaimByChild(
    childSessionId: string,
    options: { readonly prune?: boolean } = {},
  ): SubagentWorktreeResult | undefined {
    const lease = this.findByChild(childSessionId);
    if (!lease) return undefined;
    return this.reclaim(lease.id, options);
  }

  private load(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    try {
      const raw = JSON.parse(
        readFileSync(this.persistPath, "utf8"),
      ) as PersistShape;
      if (!Array.isArray(raw.leases)) return;
      for (const lease of raw.leases) {
        if (
          lease &&
          typeof lease.id === "string" &&
          typeof lease.path === "string"
        ) {
          this.leases.set(lease.id, lease);
        }
      }
    } catch {
      /* corrupt sidecar — start empty */
    }
  }

  private save(): void {
    if (!this.persistPath) return;
    tryWriteJsonSidecar(this.persistPath, {
      leases: [...this.leases.values()],
    } satisfies PersistShape);
  }
}
