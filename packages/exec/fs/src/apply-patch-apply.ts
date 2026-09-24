/**
 * Apply parsed Codex-style hunks onto LF-normalized file text (seek_sequence).
 */

import {
  detectLineEndings,
  normalizeLineEndings,
  restoreLineEndings,
} from "./edit-text.js";
import type { PatchHunk, UpdateFileChunk } from "./apply-patch-parser.js";

export class ApplyPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplyPatchError";
  }
}

type Replacement = readonly [start: number, oldLen: number, newLines: string[]];

function normaliseUnicode(s: string): string {
  return s
    .trim()
    .split("")
    .map((c) => {
      const code = c.codePointAt(0) ?? 0;
      if (
        code === 0x2010 ||
        code === 0x2011 ||
        code === 0x2012 ||
        code === 0x2013 ||
        code === 0x2014 ||
        code === 0x2015 ||
        code === 0x2212
      ) {
        return "-";
      }
      if (code === 0x2018 || code === 0x2019 || code === 0x201a || code === 0x201b) {
        return "'";
      }
      if (code === 0x201c || code === 0x201d || code === 0x201e || code === 0x201f) {
        return '"';
      }
      if (
        code === 0x00a0 ||
        (code >= 0x2002 && code <= 0x200a) ||
        code === 0x202f ||
        code === 0x205f ||
        code === 0x3000
      ) {
        return " ";
      }
      return c;
    })
    .join("");
}

/** Locate `pattern` in `lines` at/after `start` (Codex seek_sequence). */
export function seekSequence(
  lines: readonly string[],
  pattern: readonly string[],
  start: number,
  eof: boolean,
): number | undefined {
  if (pattern.length === 0) return start;
  if (pattern.length > lines.length) return undefined;

  const searchStart =
    eof && lines.length >= pattern.length
      ? Math.max(start, lines.length - pattern.length)
      : start;

  const passes: Array<(a: string, b: string) => boolean> = [
    (a, b) => a === b,
    (a, b) => a.trimEnd() === b.trimEnd(),
    (a, b) => a.trim() === b.trim(),
    (a, b) => normaliseUnicode(a) === normaliseUnicode(b),
  ];

  for (const eq of passes) {
    for (let i = searchStart; i <= lines.length - pattern.length; i += 1) {
      let ok = true;
      for (let p = 0; p < pattern.length; p += 1) {
        if (!eq(lines[i + p]!, pattern[p]!)) {
          ok = false;
          break;
        }
      }
      if (ok) return i;
    }
  }
  return undefined;
}

function splitLfLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function computeReplacements(
  originalLines: readonly string[],
  path: string,
  chunks: readonly UpdateFileChunk[],
): Replacement[] {
  const replacements: Replacement[] = [];
  let lineIndex = 0;

  for (const chunk of chunks) {
    if (chunk.changeContext !== undefined) {
      const idx = seekSequence(
        originalLines,
        [chunk.changeContext],
        lineIndex,
        false,
      );
      if (idx === undefined) {
        throw new ApplyPatchError(
          `Failed to find context '${chunk.changeContext}' in ${path}`,
        );
      }
      lineIndex = idx + 1;
    }

    if (chunk.oldLines.length === 0) {
      const insertionIdx = originalLines.length;
      replacements.push([insertionIdx, 0, [...chunk.newLines]]);
      continue;
    }

    let pattern: readonly string[] = chunk.oldLines;
    let newSlice: readonly string[] = chunk.newLines;
    let found = seekSequence(
      originalLines,
      pattern,
      lineIndex,
      chunk.isEndOfFile,
    );

    if (
      found === undefined &&
      pattern.length > 0 &&
      pattern[pattern.length - 1] === ""
    ) {
      pattern = pattern.slice(0, -1);
      if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
        newSlice = newSlice.slice(0, -1);
      }
      found = seekSequence(
        originalLines,
        pattern,
        lineIndex,
        chunk.isEndOfFile,
      );
    }

    if (found === undefined) {
      throw new ApplyPatchError(
        `Failed to find expected lines in ${path}:\n${chunk.oldLines.join("\n")}`,
      );
    }

    replacements.push([found, pattern.length, [...newSlice]]);
    lineIndex = found + pattern.length;
  }

  replacements.sort((a, b) => a[0] - b[0]);
  return replacements;
}

function applyReplacements(
  lines: string[],
  replacements: readonly Replacement[],
): string[] {
  const next = [...lines];
  for (const [startIdx, oldLen, newSegment] of [...replacements].reverse()) {
    for (let i = 0; i < oldLen; i += 1) {
      if (startIdx < next.length) next.splice(startIdx, 1);
    }
    for (let offset = 0; offset < newSegment.length; offset += 1) {
      next.splice(startIdx + offset, 0, newSegment[offset]!);
    }
  }
  return next;
}

/** Derive new file body (LF + trailing newline) from update chunks. */
export function deriveUpdatedContents(
  originalRaw: string,
  path: string,
  chunks: readonly UpdateFileChunk[],
): { readonly original: string; readonly next: string } {
  const endings = detectLineEndings(originalRaw);
  const originalLf = normalizeLineEndings(originalRaw);
  const originalLines = splitLfLines(originalLf);
  const replacements = computeReplacements(originalLines, path, chunks);
  const newLines = applyReplacements(originalLines, replacements);
  if (newLines.length === 0 || newLines[newLines.length - 1] !== "") {
    newLines.push("");
  }
  const nextLf = newLines.join("\n");
  return {
    original: originalRaw,
    next: restoreLineEndings(nextLf, endings),
  };
}

export interface ApplyPatchFileOp {
  readonly action: "add" | "update" | "delete" | "move";
  readonly path: string;
  readonly fromPath?: string;
}

export interface ApplyPatchPlan {
  readonly ops: readonly ApplyPatchFileOp[];
  /** Path → final UTF-8 contents (missing for pure deletes). */
  readonly writes: ReadonlyMap<string, string>;
  /** Paths to unlink after writes (delete + move source). */
  readonly deletes: readonly string[];
}

/**
 * Pure planning step: compute all writes/deletes from hunks + current file map.
 * `readFile` returns raw UTF-8 or `undefined` when missing.
 */
export function planPatchApplication(
  hunks: readonly PatchHunk[],
  readFile: (path: string) => string | undefined,
): ApplyPatchPlan {
  const writes = new Map<string, string>();
  const deletes: string[] = [];
  const ops: ApplyPatchFileOp[] = [];

  for (const hunk of hunks) {
    if (hunk.kind === "add") {
      if (readFile(hunk.path) !== undefined || writes.has(hunk.path)) {
        throw new ApplyPatchError(`Add File failed: ${hunk.path} already exists`);
      }
      writes.set(hunk.path, hunk.contents);
      ops.push({ action: "add", path: hunk.path });
      continue;
    }
    if (hunk.kind === "delete") {
      if (readFile(hunk.path) === undefined && !writes.has(hunk.path)) {
        throw new ApplyPatchError(`Delete File failed: ${hunk.path} not found`);
      }
      writes.delete(hunk.path);
      deletes.push(hunk.path);
      ops.push({ action: "delete", path: hunk.path });
      continue;
    }

    const raw = writes.get(hunk.path) ?? readFile(hunk.path);
    if (raw === undefined) {
      throw new ApplyPatchError(`Update File failed: ${hunk.path} not found`);
    }
    if (hunk.chunks.length === 0 && !hunk.movePath) {
      throw new ApplyPatchError(
        `Update file hunk for path '${hunk.path}' is empty`,
      );
    }
    const updated =
      hunk.chunks.length === 0
        ? raw
        : deriveUpdatedContents(raw, hunk.path, hunk.chunks).next;
    const dest = hunk.movePath ?? hunk.path;
    if (hunk.movePath) {
      if (readFile(hunk.movePath) !== undefined || writes.has(hunk.movePath)) {
        throw new ApplyPatchError(
          `Move failed: destination ${hunk.movePath} already exists`,
        );
      }
      writes.delete(hunk.path);
      deletes.push(hunk.path);
      writes.set(hunk.movePath, updated);
      ops.push({
        action: "move",
        path: hunk.movePath,
        fromPath: hunk.path,
      });
    } else {
      writes.set(dest, updated);
      ops.push({ action: "update", path: dest });
    }
  }

  return { ops, writes, deletes };
}
