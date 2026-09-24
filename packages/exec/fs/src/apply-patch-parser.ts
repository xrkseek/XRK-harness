/**
 * Codex apply_patch grammar (portable subset).
 * Markers: Begin/End Patch · Add/Delete/Update File · Move to · @@ · End of File.
 */

export const BEGIN_PATCH_MARKER = "*** Begin Patch";
export const END_PATCH_MARKER = "*** End Patch";
export const ADD_FILE_MARKER = "*** Add File: ";
export const DELETE_FILE_MARKER = "*** Delete File: ";
export const UPDATE_FILE_MARKER = "*** Update File: ";
export const MOVE_TO_MARKER = "*** Move to: ";
export const EOF_MARKER = "*** End of File";
export const CHANGE_CONTEXT_MARKER = "@@ ";
export const EMPTY_CHANGE_CONTEXT_MARKER = "@@";

export class PatchParseError extends Error {
  readonly lineNumber?: number;

  constructor(message: string, lineNumber?: number) {
    super(message);
    this.name = "PatchParseError";
    if (lineNumber !== undefined) this.lineNumber = lineNumber;
  }
}

export interface UpdateFileChunk {
  readonly changeContext?: string;
  readonly oldLines: string[];
  readonly newLines: string[];
  /** Pairs of indices into old/new that were explicit context (` ` lines). */
  readonly contextLineIndices: ReadonlyArray<readonly [number, number]>;
  readonly isEndOfFile: boolean;
}

export type PatchHunk =
  | { readonly kind: "add"; readonly path: string; readonly contents: string }
  | { readonly kind: "delete"; readonly path: string }
  | {
      readonly kind: "update";
      readonly path: string;
      readonly movePath?: string;
      readonly chunks: readonly UpdateFileChunk[];
    };

export interface ParsedPatch {
  readonly hunks: readonly PatchHunk[];
  readonly patch: string;
}

type MutableUpdate = {
  kind: "update";
  path: string;
  movePath?: string;
  chunks: Array<{
    changeContext?: string;
    oldLines: string[];
    newLines: string[];
    contextLineIndices: Array<[number, number]>;
    isEndOfFile: boolean;
  }>;
};

type MutableAdd = { kind: "add"; path: string; contents: string };

function pushContext(
  chunk: {
    oldLines: string[];
    newLines: string[];
    contextLineIndices: Array<[number, number]>;
  },
  line: string,
): void {
  chunk.contextLineIndices.push([chunk.oldLines.length, chunk.newLines.length]);
  chunk.oldLines.push(line);
  chunk.newLines.push(line);
}

/**
 * Parse a full `*** Begin Patch` … `*** End Patch` document into hunks.
 * Lenient: trims marker lines; strips a trivial `<<EOF` heredoc wrapper.
 */
export function parsePatch(raw: string): ParsedPatch {
  let text = raw.trim();
  const heredoc = text.match(/^<<['"]?EOF['"]?\r?\n([\s\S]*?)\r?\nEOF\s*$/);
  if (heredoc?.[1] !== undefined) text = heredoc[1].trim();

  const lines = text.split(/\r?\n/);
  if (lines.length === 0) {
    throw new PatchParseError(
      "The first line of the patch must be '*** Begin Patch'",
    );
  }

  const hunks: Array<MutableAdd | { kind: "delete"; path: string } | MutableUpdate> =
    [];
  /** not-started | started | add | delete | update | ended */
  let mode = "not-started";
  let updateHunkLine = 0;
  let lineNumber = 0;

  const ensureUpdateNotEmpty = (forLine: string): void => {
    const last = hunks[hunks.length - 1];
    if (!last || last.kind !== "update") return;
    if (last.chunks.length === 0 && mode === "update") {
      throw new PatchParseError(
        `Update file hunk for path '${last.path}' is empty`,
        updateHunkLine,
      );
    }
    const chunk = last.chunks[last.chunks.length - 1];
    if (chunk && chunk.oldLines.length === 0 && chunk.newLines.length === 0) {
      if (forLine.trim() === END_PATCH_MARKER) {
        throw new PatchParseError(
          "Update hunk does not contain any lines",
          lineNumber,
        );
      }
      throw new PatchParseError(
        `Unexpected line found in update hunk: '${forLine}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
        lineNumber,
      );
    }
  };

  const startHunkHeader = (trimmed: string): boolean => {
    if (trimmed === END_PATCH_MARKER) {
      ensureUpdateNotEmpty(trimmed);
      mode = "ended";
      return true;
    }
    if (trimmed.startsWith(ADD_FILE_MARKER)) {
      ensureUpdateNotEmpty(trimmed);
      hunks.push({
        kind: "add",
        path: trimmed.slice(ADD_FILE_MARKER.length),
        contents: "",
      });
      mode = "add";
      return true;
    }
    if (trimmed.startsWith(DELETE_FILE_MARKER)) {
      ensureUpdateNotEmpty(trimmed);
      hunks.push({
        kind: "delete",
        path: trimmed.slice(DELETE_FILE_MARKER.length),
      });
      mode = "delete";
      return true;
    }
    if (trimmed.startsWith(UPDATE_FILE_MARKER)) {
      ensureUpdateNotEmpty(trimmed);
      hunks.push({
        kind: "update",
        path: trimmed.slice(UPDATE_FILE_MARKER.length),
        chunks: [],
      });
      mode = "update";
      updateHunkLine = lineNumber;
      return true;
    }
    return false;
  };

  for (const line of lines) {
    lineNumber += 1;
    const trimmed = line.trim();

    if (mode === "not-started") {
      if (trimmed === BEGIN_PATCH_MARKER) {
        mode = "started";
        continue;
      }
      throw new PatchParseError(
        "The first line of the patch must be '*** Begin Patch'",
        lineNumber,
      );
    }

    if (mode === "ended") {
      if (trimmed === "") continue;
      throw new PatchParseError(
        `Unexpected content after '*** End Patch': '${trimmed}'`,
        lineNumber,
      );
    }

    if (mode === "started") {
      if (startHunkHeader(trimmed)) continue;
      throw new PatchParseError(
        `'${trimmed}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
        lineNumber,
      );
    }

    if (mode === "add") {
      if (startHunkHeader(trimmed)) continue;
      if (line.startsWith("+")) {
        const last = hunks[hunks.length - 1];
        if (last?.kind === "add") {
          last.contents += `${line.slice(1)}\n`;
        }
        continue;
      }
      throw new PatchParseError(
        `'${trimmed}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
        lineNumber,
      );
    }

    if (mode === "delete") {
      if (startHunkHeader(trimmed)) continue;
      throw new PatchParseError(
        `'${trimmed}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
        lineNumber,
      );
    }

    // update
    const updateLine = line.trimEnd();
    if (startHunkHeader(updateLine.trim())) continue;

    const last = hunks[hunks.length - 1];
    if (!last || last.kind !== "update") {
      throw new PatchParseError("internal: expected update hunk", lineNumber);
    }
    const update = last;

    if (update.chunks.at(-1)?.isEndOfFile) {
      if (updateLine === "") continue;
      if (
        updateLine !== EMPTY_CHANGE_CONTEXT_MARKER &&
        !updateLine.startsWith(CHANGE_CONTEXT_MARKER)
      ) {
        throw new PatchParseError(
          `Expected update hunk to start with a @@ context marker, got: '${line}'`,
          lineNumber,
        );
      }
    }

    if (
      update.chunks.length === 0 &&
      update.movePath === undefined &&
      updateLine.startsWith(MOVE_TO_MARKER)
    ) {
      update.movePath = updateLine.slice(MOVE_TO_MARKER.length);
      continue;
    }

    if (
      (updateLine === EMPTY_CHANGE_CONTEXT_MARKER ||
        updateLine.startsWith(CHANGE_CONTEXT_MARKER)) &&
      update.chunks.at(-1) &&
      update.chunks.at(-1)!.oldLines.length === 0 &&
      update.chunks.at(-1)!.newLines.length === 0
    ) {
      throw new PatchParseError(
        `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
        lineNumber,
      );
    }

    if (updateLine === EMPTY_CHANGE_CONTEXT_MARKER) {
      update.chunks.push({
        oldLines: [],
        newLines: [],
        contextLineIndices: [],
        isEndOfFile: false,
      });
      continue;
    }

    if (updateLine.startsWith(CHANGE_CONTEXT_MARKER)) {
      update.chunks.push({
        changeContext: updateLine.slice(CHANGE_CONTEXT_MARKER.length),
        oldLines: [],
        newLines: [],
        contextLineIndices: [],
        isEndOfFile: false,
      });
      continue;
    }

    if (updateLine === EOF_MARKER) {
      const chunk = update.chunks.at(-1);
      if (!chunk || (chunk.oldLines.length === 0 && chunk.newLines.length === 0)) {
        throw new PatchParseError(
          "Update hunk does not contain any lines",
          lineNumber,
        );
      }
      chunk.isEndOfFile = true;
      continue;
    }

    const ensureChunk = () => {
      if (update.chunks.length === 0) {
        update.chunks.push({
          oldLines: [],
          newLines: [],
          contextLineIndices: [],
          isEndOfFile: false,
        });
      }
      return update.chunks[update.chunks.length - 1]!;
    };

    if (line === "") {
      pushContext(ensureChunk(), "");
      continue;
    }
    if (line.startsWith(" ")) {
      pushContext(ensureChunk(), line.slice(1));
      continue;
    }
    if (line.startsWith("+")) {
      ensureChunk().newLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith("-")) {
      ensureChunk().oldLines.push(line.slice(1));
      continue;
    }

    const lastChunk = update.chunks.at(-1);
    if (
      lastChunk &&
      (lastChunk.oldLines.length > 0 || lastChunk.newLines.length > 0)
    ) {
      throw new PatchParseError(
        `Expected update hunk to start with a @@ context marker, got: '${line}'`,
        lineNumber,
      );
    }
    throw new PatchParseError(
      `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
      lineNumber,
    );
  }

  if (mode !== "ended") {
    throw new PatchParseError(
      "The last line of the patch must be '*** End Patch'",
    );
  }
  if (hunks.length === 0) {
    throw new PatchParseError("Patch contains no hunks");
  }

  return { hunks: hunks, patch: text };
}

/** Paths that already exist on disk and must be observed (write-intent). */
export function patchPathsRequiringRead(
  hunks: readonly PatchHunk[],
): readonly string[] {
  const out: string[] = [];
  for (const hunk of hunks) {
    if (hunk.kind === "add") continue;
    out.push(hunk.path);
  }
  return out;
}

/** All paths touched by the patch (for presentation / intent emit). */
export function patchTouchedPaths(
  hunks: readonly PatchHunk[],
): readonly string[] {
  const out: string[] = [];
  for (const hunk of hunks) {
    if (hunk.kind === "add" || hunk.kind === "delete") {
      out.push(hunk.path);
    } else {
      out.push(hunk.path);
      if (hunk.movePath) out.push(hunk.movePath);
    }
  }
  return out;
}
