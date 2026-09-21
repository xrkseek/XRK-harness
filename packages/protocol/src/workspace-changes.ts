/**
 * Turn-end workspace file changes (DSH deliverables/workspace-changes).
 * SessionEvent announces; Face `workspaceChanges` projection folds summaries
 * for the conversation card. Per-file hunks are served lazily later
 * (`WorkspaceFileDiff`) — not duplicated into every log row.
 */

/**
 * One file mutation from a tool present card (`DiffCallView` / `DiffResultView`).
 * Same fields as `@xrkseek/core-tools` `FileDiff` (re-exported from here) so
 * exec-fs presenters and {@link summarizeFileDiffs} share one shape.
 *
 * `oldText` is `null` for a create / call-time overwrite (no prior content);
 * `newText` is the after side (may be `""` for a full delete).
 */
export interface FileDiff {
  readonly path: string;
  readonly oldText: string | null;
  readonly newText: string;
}

/** One file changed during a turn (card row + sidebar list). */
export interface WorkspaceChangedFile {
  /** Path relative to session cwd, or absolute when outside. */
  readonly path: string;
  /**
   * Display / sort key: relative path, `~/…`, or absolute — slash-separated.
   */
  readonly display: string;
  /** Lines added; zero for binary / oversized. */
  readonly added: number;
  /** Lines deleted; zero for binary / oversized. */
  readonly deleted: number;
  readonly binary?: true;
  readonly oversized?: true;
}

/** Files changed in one top-level turn (embedded on the SessionEvent for cold reopen). */
export interface WorkspaceChangesSummary {
  readonly turnId: string;
  /** Session working directory `path` values are relative to. */
  readonly cwd: string;
  /** Changed files in `display` order (may be capped). */
  readonly files: readonly WorkspaceChangedFile[];
  /** Complete changed-file count, including omitted by the cap. */
  readonly total: number;
  /** Lines added over every changed file (including omitted). */
  readonly added: number;
  /** Lines deleted over every changed file (including omitted). */
  readonly deleted: number;
  /** Optional git tree ids when a turn snapshot was taken. */
  readonly snapshot?: { readonly before: string; readonly after: string };
}

/** One unified-diff hunk; every line keeps its `+` / `-` / space prefix. */
export interface WorkspaceDiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly string[];
}

/**
 * Lazy per-file comparison for the sidebar (Host/Face RPC later).
 * Not stored on the SessionEvent — computed on demand from captures / git.
 */
export type WorkspaceFileDiff =
  | {
      readonly kind: "text";
      readonly path: string;
      readonly display: string;
      readonly before: boolean;
      readonly after: boolean;
      readonly hunks: readonly WorkspaceDiffHunk[];
      /** True when the comparison fell back to whole-file replace. */
      readonly coarse: boolean;
    }
  | { readonly kind: "binary"; readonly path: string; readonly display: string }
  | {
      readonly kind: "oversized";
      readonly path: string;
      readonly display: string;
    };

/** Cap listed files on the durable summary (DSH-style list budget). */
export const WORKSPACE_CHANGES_MAX_FILES = 64;

/**
 * Split a FileDiff side into content lines — same terminator rule as DiffBlock /
 * DSH: empty → zero lines; a single trailing newline is a terminator, not an
 * extra blank row. Interior `\n\n` blank lines survive.
 */
export function fileDiffContentLines(text: string): string[] {
  if (text === "") return [];
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split("\n");
}

/**
 * Build a summary from per-tool {@link FileDiff} captures (inline cards → turn card).
 * Coalesces by path (last write wins for content; line counts sum).
 * Line totals follow {@link fileDiffContentLines} so the card strip matches DiffBlock.
 */
export function summarizeFileDiffs(input: {
  readonly turnId: string;
  readonly cwd: string;
  readonly diffs: readonly FileDiff[];
  readonly maxFiles?: number;
}): WorkspaceChangesSummary {
  const maxFiles = input.maxFiles ?? WORKSPACE_CHANGES_MAX_FILES;
  const byPath = new Map<
    string,
    { path: string; display: string; added: number; deleted: number }
  >();
  for (const d of input.diffs) {
    const path = d.path.replace(/\\/g, "/");
    const display = path;
    const deleted =
      d.oldText === null ? 0 : fileDiffContentLines(d.oldText).length;
    const added = fileDiffContentLines(d.newText).length;
    const prev = byPath.get(path);
    if (prev) {
      byPath.set(path, {
        path,
        display,
        added: prev.added + added,
        deleted: prev.deleted + deleted,
      });
    } else {
      byPath.set(path, { path, display, added, deleted });
    }
  }
  const all = [...byPath.values()].sort((a, b) =>
    a.display.localeCompare(b.display),
  );
  const files = all.slice(0, maxFiles).map((f) => ({
    path: f.path,
    display: f.display,
    added: f.added,
    deleted: f.deleted,
  }));
  let added = 0;
  let deleted = 0;
  for (const f of all) {
    added += f.added;
    deleted += f.deleted;
  }
  return {
    turnId: input.turnId,
    cwd: input.cwd.replace(/\\/g, "/"),
    files,
    total: all.length,
    added,
    deleted,
  };
}

/** Normalize path keys the same way {@link summarizeFileDiffs} does. */
export function normalizeWorkspacePath(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * First-before / last-after texts for one path across a turn's FileDiff captures.
 * Returns undefined when the path never appears.
 */
export function coalesceFileDiffTexts(
  diffs: readonly FileDiff[],
  path: string,
): { readonly oldText: string | null; readonly newText: string } | undefined {
  const key = normalizeWorkspacePath(path);
  let oldText: string | null | undefined;
  let newText: string | undefined;
  for (const d of diffs) {
    if (normalizeWorkspacePath(d.path) !== key) continue;
    if (oldText === undefined) oldText = d.oldText;
    newText = d.newText;
  }
  if (newText === undefined) return undefined;
  return { oldText: oldText ?? null, newText };
}

/**
 * Build a per-file comparison for Face `changes.fileDiff`.
 * Uses a whole-file replace hunk (`coarse: true`) — same line split as
 * {@link summarizeFileDiffs} / DiffBlock; Myers/timeout compare can land later.
 */
export function workspaceFileDiffFromTexts(input: {
  readonly path: string;
  readonly display: string;
  readonly oldText: string | null;
  readonly newText: string | null;
}): WorkspaceFileDiff {
  const path = normalizeWorkspacePath(input.path);
  const display = input.display || path;
  const before = input.oldText;
  const after = input.newText;
  if (
    (before !== null && before.includes("\0")) ||
    (after !== null && after.includes("\0"))
  ) {
    return { kind: "binary", path, display };
  }
  const oldLines = before === null ? [] : fileDiffContentLines(before);
  const newLines = after === null ? [] : fileDiffContentLines(after);
  const hunks: WorkspaceDiffHunk[] =
    oldLines.length === 0 && newLines.length === 0
      ? []
      : [
          {
            oldStart: 1,
            oldLines: oldLines.length,
            newStart: 1,
            newLines: newLines.length,
            lines: [
              ...oldLines.map((line) => `-${line}`),
              ...newLines.map((line) => `+${line}`),
            ],
          },
        ];
  return {
    kind: "text",
    path,
    display,
    before: before !== null,
    after: after !== null,
    hunks,
    coarse: true,
  };
}

/**
 * Resolve one listed summary file against turn FileDiff captures.
 * Missing captures → undefined (RPC returns null).
 */
export function workspaceFileDiffForListedFile(input: {
  readonly file: WorkspaceChangedFile;
  readonly diffs: readonly FileDiff[];
}): WorkspaceFileDiff | undefined {
  if (input.file.binary) {
    return {
      kind: "binary",
      path: normalizeWorkspacePath(input.file.path),
      display: input.file.display,
    };
  }
  if (input.file.oversized) {
    return {
      kind: "oversized",
      path: normalizeWorkspacePath(input.file.path),
      display: input.file.display,
    };
  }
  const texts = coalesceFileDiffTexts(input.diffs, input.file.path);
  if (!texts) return undefined;
  return workspaceFileDiffFromTexts({
    path: input.file.path,
    display: input.file.display,
    oldText: texts.oldText,
    newText: texts.newText,
  });
}
