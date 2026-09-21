/**
 * Recoverable workspace file snapshots for turn rewind.
 *
 * A snapshot is a commit in a **shadow** git repository: a separate
 * `--git-dir` that points at the workspace as its work-tree. The user's own
 * `.git` is never read or written, so checkpointing works in a plain
 * directory and cannot rewrite the operator's history.
 */

/** Result of one git invocation. Negative `code` means git did not start. */
export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Injected git seam. Production uses {@link createProcessGitRunner}; tests
 * pass a scripted fake so the command sequence is asserted without spawning.
 */
export type GitRunner = (
  args: readonly string[],
  opts?: { readonly cwd?: string },
) => Promise<GitResult>;

/** One recoverable point, keyed by the shadow commit sha. */
export interface WorkspaceCheckpointRecord {
  /** Shadow-repo commit sha — the snapshot id used by `restore`. */
  readonly id: string;
  readonly sessionId: string;
  /** Session log seq the workspace state precedes. */
  readonly seq: number;
  /** Epoch ms when the snapshot was taken. */
  readonly createdAt: number;
  readonly label?: string;
  /** Tracked files captured at this point. */
  readonly fileCount: number;
}

export interface SnapshotInput {
  readonly sessionId: string;
  /** Session log seq; `-1` for a snapshot taken before the first turn. */
  readonly seq: number;
  readonly label?: string;
}

export interface RestoreOptions {
  /**
   * Also delete worktree files the snapshot does not know about
   * (`git clean -fd`). Ignored paths are never touched. Default `false`.
   */
  readonly prune?: boolean;
}

export interface RestorePlan {
  readonly id: string;
  /** Files the snapshot defines (restored by `checkout`). */
  readonly fileCount: number;
  /** Untracked, non-ignored files present now but absent from the snapshot. */
  readonly extra: readonly string[];
}

export interface RestoreResult extends RestorePlan {
  readonly restored: number;
  readonly removed: readonly string[];
}

export type WorkspaceCheckpointErrorCode =
  | "bad-argument"
  | "git-unavailable"
  | "init-failed"
  | "snapshot-failed"
  | "restore-failed"
  | "unknown-checkpoint";

/** Failure with a stable code so callers can map it to a tool result. */
export class WorkspaceCheckpointError extends Error {
  readonly code: WorkspaceCheckpointErrorCode;

  constructor(code: WorkspaceCheckpointErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceCheckpointError";
    this.code = code;
  }
}
