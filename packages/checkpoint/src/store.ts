import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-file.js";
import {
  WorkspaceCheckpointError,
  type GitResult,
  type GitRunner,
  type RestoreOptions,
  type RestorePlan,
  type RestoreResult,
  type SnapshotInput,
  type WorkspaceCheckpointErrorCode,
  type WorkspaceCheckpointRecord,
} from "./types.js";

const INDEX_VERSION = 1;
const ID_LENGTH = 12;

/**
 * Synthetic commit identity for shadow commits. The store must not depend on
 * (or write to) the operator's git config.
 */
export const CHECKPOINT_AUTHOR_NAME = "XRK Checkpoint";
export const CHECKPOINT_AUTHOR_EMAIL = "checkpoint@xrk.invalid";

/** Stable, filesystem-safe id for one workspace path. */
export function workspaceCheckpointId(workspaceDir: string): string {
  return createHash("sha1")
    .update(path.resolve(workspaceDir))
    .digest("hex")
    .slice(0, ID_LENGTH);
}

/** `<workspace>/.xrk/checkpoints` — shadow repo + index live here. */
export function workspaceCheckpointDir(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), ".xrk", "checkpoints");
}

/** Shadow git dir inside the checkpoint dir. */
export function shadowGitDir(shadowDir: string): string {
  return path.join(shadowDir, "git");
}

/** Snapshot index (chronological records) inside the checkpoint dir. */
export function checkpointIndexPath(shadowDir: string): string {
  return path.join(shadowDir, "index.json");
}

/** Git-level ignore file pinning the shadow dir out of every snapshot. */
export function checkpointExcludePath(shadowDir: string): string {
  return path.join(shadowDir, "exclude");
}

export interface WorkspaceCheckpointStoreOptions {
  readonly workspaceDir: string;
  readonly runGit: GitRunner;
  /** Defaults to {@link workspaceCheckpointDir}. */
  readonly shadowDir?: string;
  /** Defaults to `index.json` inside the shadow dir. */
  readonly indexFile?: string;
  readonly now?: () => number;
}

interface PersistedIndex {
  readonly version?: number;
  readonly records?: readonly WorkspaceCheckpointRecord[];
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Parse `git clean` output lines carrying a known prefix. */
function parseCleanOutput(stdout: string, prefix: string): string[] {
  const out: string[] = [];
  for (const line of splitLines(stdout)) {
    if (!line.startsWith(prefix)) continue;
    const entry = line.slice(prefix.length).trim();
    if (entry.length > 0) out.push(entry);
  }
  return out;
}

function isCheckpointRecord(value: unknown): value is WorkspaceCheckpointRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.sessionId === "string" &&
    typeof record.seq === "number" &&
    Number.isFinite(record.seq) &&
    typeof record.createdAt === "number" &&
    typeof record.fileCount === "number"
  );
}

/**
 * Turn-scoped workspace snapshots in a shadow git repo.
 *
 * Every command pins `--git-dir=<shadow>` **and** `--work-tree=<workspace>`, so
 * the operator's own repository (and its history) is never touched. `snapshot`
 * commits the current worktree (`--allow-empty`, so a no-change turn still
 * records a recoverable point); `restore` checks that commit back out, leaving
 * files the snapshot never saw in place unless `prune` is requested.
 *
 * The shadow dir usually lives *inside* the workspace, so it is pinned into
 * `core.excludesFile`. Without that, `add -A` would stage the repo's own
 * objects and `clean -fd` would delete them.
 */
export class WorkspaceCheckpointStore {
  readonly workspaceDir: string;
  readonly shadowDir: string;
  /** {@link workspaceCheckpointId} for this workspace. */
  readonly id: string;
  /** Git-level ignore file (see {@link checkpointExcludePath}). */
  readonly excludesFile: string;

  private readonly gitDir: string;
  private readonly indexFile: string;
  private readonly runGit: GitRunner;
  private readonly now: () => number;
  /** Work-tree-relative shadow path, when the shadow lives in the workspace. */
  private readonly shadowRelPath: string | undefined;
  private records: WorkspaceCheckpointRecord[];
  private repoReady = false;

  constructor(options: WorkspaceCheckpointStoreOptions) {
    const workspace = path.resolve(options.workspaceDir);
    this.workspaceDir = workspace;
    this.id = workspaceCheckpointId(workspace);
    const shadow = path.resolve(options.shadowDir ?? workspaceCheckpointDir(workspace));
    this.shadowDir = shadow;
    this.gitDir = shadowGitDir(shadow);
    this.excludesFile = checkpointExcludePath(shadow);
    this.indexFile = options.indexFile ?? checkpointIndexPath(shadow);
    const rel = path.relative(workspace, shadow);
    this.shadowRelPath =
      rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel)
        ? rel.split(path.sep).join("/")
        : undefined;
    this.runGit = options.runGit;
    this.now = options.now ?? (() => Date.now());
    this.records = this.loadIndex();
  }

  /**
   * Git-level argv shared by every command.
   *
   * - `core.excludesFile` keeps the shadow dir out of staging and `clean`.
   * - `core.autocrlf=false` stops a Windows checkout rewriting line endings.
   * - A synthetic commit identity + `commit.gpgsign=false` make shadow commits
   *   independent of the operator's git config, so snapshotting works on a
   *   machine with no `user.name` / `user.email` and never tries to sign.
   */
  private get baseArgs(): readonly string[] {
    return [
      `--git-dir=${this.gitDir}`,
      `--work-tree=${this.workspaceDir}`,
      "-c",
      `core.excludesFile=${this.excludesFile}`,
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.safecrlf=false",
      "-c",
      "core.filemode=false",
      "-c",
      "commit.gpgsign=false",
      "-c",
      `user.name=${CHECKPOINT_AUTHOR_NAME}`,
      "-c",
      `user.email=${CHECKPOINT_AUTHOR_EMAIL}`,
    ];
  }

  private async exec(args: readonly string[]): Promise<GitResult> {
    return this.runGit([...this.baseArgs, ...args]);
  }

  private async execOk(
    args: readonly string[],
    errorCode: WorkspaceCheckpointErrorCode,
    what: string,
  ): Promise<GitResult> {
    const result = await this.exec(args);
    if (result.code === -1) {
      throw new WorkspaceCheckpointError(
        "git-unavailable",
        `git ${what} could not start: ${
          result.stderr.trim() || "git was not found on PATH"
        }`,
      );
    }
    if (result.code !== 0) {
      throw new WorkspaceCheckpointError(
        errorCode,
        `git ${what} failed (exit ${result.code}): ${
          result.stderr.trim() || result.stdout.trim()
        }`,
      );
    }
    return result;
  }

  /**
   * (Re)write the git-level ignore file. Idempotent and cheap: patterns are
   * only rewritten when the content differs. Safety-critical — `clean -fd`
   * must never see the shadow repo as untracked.
   */
  private ensureExcludesFile(): void {
    mkdirSync(this.shadowDir, { recursive: true });
    const patterns: string[] = [];
    if (this.shadowRelPath) patterns.push(`${this.shadowRelPath}/`);
    const content = patterns.length > 0 ? `${patterns.join("\n")}\n` : "";
    try {
      if (existsSync(this.excludesFile)) {
        if (readFileSync(this.excludesFile, "utf8") === content) return;
      }
      writeFileSync(this.excludesFile, content, "utf8");
    } catch {
      /* read-only workspace: git will still work, only self-ignore is lost */
    }
  }

  /** Create the shadow repo on first use; idempotent afterwards. */
  private async ensureRepo(): Promise<void> {
    if (this.repoReady) return;
    this.ensureExcludesFile();
    if (!existsSync(path.join(this.gitDir, "HEAD"))) {
      await this.execOk(["init", "--quiet"], "init-failed", "init (shadow repo)");
    }
    this.repoReady = true;
  }

  /** Like {@link ensureRepo} but never creates: a missing repo is a lost point. */
  private async requireRepo(): Promise<void> {
    if (this.repoReady) return;
    if (!existsSync(path.join(this.gitDir, "HEAD"))) {
      throw new WorkspaceCheckpointError(
        "unknown-checkpoint",
        `shadow checkpoint repo is missing at ${this.gitDir}`,
      );
    }
    this.ensureExcludesFile();
    this.repoReady = true;
  }

  /** Snapshot the workspace and record it against a session seq. */
  async snapshot(input: SnapshotInput): Promise<WorkspaceCheckpointRecord> {
    const sessionId = input.sessionId.trim();
    if (!sessionId) {
      throw new WorkspaceCheckpointError(
        "bad-argument",
        "snapshot: sessionId is required",
      );
    }
    if (!Number.isFinite(input.seq)) {
      throw new WorkspaceCheckpointError(
        "bad-argument",
        "snapshot: seq must be a finite number",
      );
    }
    await this.ensureRepo();
    await this.execOk(["add", "-A"], "snapshot-failed", "add -A");
    const label = input.label?.trim();
    const message = [
      `xrk checkpoint session=${sessionId} seq=${input.seq}`,
      ...(label ? [`label=${label}`] : []),
    ].join(" ");
    await this.execOk(
      ["commit", "--quiet", "--allow-empty", "-m", message],
      "snapshot-failed",
      "commit",
    );
    const rev = await this.execOk(
      ["rev-parse", "HEAD"],
      "snapshot-failed",
      "rev-parse HEAD",
    );
    const id = rev.stdout.trim();
    if (!id) {
      throw new WorkspaceCheckpointError(
        "snapshot-failed",
        "git rev-parse HEAD returned no commit id",
      );
    }
    const files = await this.execOk(["ls-files"], "snapshot-failed", "ls-files");
    const record: WorkspaceCheckpointRecord = {
      id,
      sessionId,
      seq: input.seq,
      createdAt: this.now(),
      ...(label ? { label } : {}),
      fileCount: splitLines(files.stdout).length,
    };
    this.records.push(record);
    this.saveIndex();
    return record;
  }

  /** Chronological (oldest first) records, newest last. */
  list(): readonly WorkspaceCheckpointRecord[] {
    return [...this.records];
  }

  get(id: string): WorkspaceCheckpointRecord {
    const needle = id.trim();
    const found = this.records.find((record) => record.id === needle);
    if (!found) {
      throw new WorkspaceCheckpointError(
        "unknown-checkpoint",
        `unknown checkpoint: ${needle || "(empty id)"}`,
      );
    }
    return found;
  }

  /** Untracked, non-ignored files present now but absent from the snapshot. */
  private async extraFiles(): Promise<string[]> {
    const clean = await this.execOk(["clean", "-nd"], "restore-failed", "clean -nd");
    return parseCleanOutput(clean.stdout, "Would remove ");
  }

  /** What a restore would restore and which files it would leave behind. */
  async planRestore(id: string): Promise<RestorePlan> {
    this.get(id);
    await this.requireRepo();
    const target = id.trim();
    const tree = await this.execOk(
      ["ls-tree", "-r", "--name-only", target],
      "restore-failed",
      `ls-tree ${target}`,
    );
    return {
      id: target,
      fileCount: splitLines(tree.stdout).length,
      extra: await this.extraFiles(),
    };
  }

  /**
   * Restore the snapshot into the worktree. Files the snapshot does not know
   * about survive unless `prune` is set.
   */
  async restore(id: string, options: RestoreOptions = {}): Promise<RestoreResult> {
    this.get(id);
    await this.requireRepo();
    const target = id.trim();
    const plan = await this.planRestore(target);
    await this.execOk(
      ["checkout", "--force", target, "--", "."],
      "restore-failed",
      `checkout ${target}`,
    );
    let removed: string[] = [];
    if (options.prune) {
      const clean = await this.execOk(["clean", "-fd"], "restore-failed", "clean -fd");
      removed = parseCleanOutput(clean.stdout, "Removing ");
    }
    return {
      ...plan,
      restored: plan.fileCount,
      removed,
    };
  }

  /**
   * Drop the oldest records, keeping the newest `keep`. Index-only: the
   * shadow commits stay until git prunes them, so a dropped record is still
   * restorable by sha when the operator kept a copy.
   */
  prune(keep: number): string[] {
    if (!Number.isInteger(keep) || keep < 0) {
      throw new WorkspaceCheckpointError(
        "bad-argument",
        `prune: keep must be a non-negative integer (got ${String(keep)})`,
      );
    }
    const drop = Math.max(0, this.records.length - keep);
    if (drop === 0) return [];
    const removed = this.records.splice(0, drop).map((record) => record.id);
    this.saveIndex();
    return removed;
  }

  private loadIndex(): WorkspaceCheckpointRecord[] {
    const raw = readJsonFile<PersistedIndex>(this.indexFile);
    const records = raw?.records;
    if (!Array.isArray(records)) return [];
    return records.filter(isCheckpointRecord);
  }

  private saveIndex(): void {
    writeJsonFileAtomic(this.indexFile, {
      version: INDEX_VERSION,
      records: this.records,
    } satisfies PersistedIndex);
  }
}
