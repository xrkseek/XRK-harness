/**
 * DSH-style literal edit: match in LF-normalized space, write back with the
 * original file's line endings. Fallback tiers tolerate trailing / surrounding
 * whitespace drift (exact → rstrip-per-line → trim), mirroring apply-patch
 * seek_sequence.
 */

export type LineEndings = "LF" | "CRLF";

/** Which matcher hit; surfaced in tool results when not exact. */
export type EditMatchTier = "exact" | "rstrip" | "trim";

export function normalizeLineEndings(content: string): string {
  return content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function detectLineEndings(raw: string): LineEndings {
  const sample = raw.slice(0, 4096);
  const crlfCount = sample.split("\r\n").length - 1;
  const lfCount = sample.split("\n").length - 1 - crlfCount;
  return crlfCount > lfCount ? "CRLF" : "LF";
}

export function restoreLineEndings(
  content: string,
  lineEndings: LineEndings,
): string {
  if (lineEndings === "LF") return content;
  return normalizeLineEndings(content).split("\n").join("\r\n");
}

function countOccurrences(content: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    const found = content.indexOf(needle, index);
    if (found === -1) return count;
    count += 1;
    index = found + needle.length;
  }
}

export class EditAmbiguousError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditAmbiguousError";
  }
}

/** Split LF text into lines, keeping a trailing empty line when content ends with `\n`. */
function splitLines(content: string): string[] {
  return content.split("\n");
}

/**
 * Byte offsets for each line start in `content` (LF). `offsets[i]` is the index
 * of the first char of line i; when content ends with `\n`, the last offset is
 * past the final newline (empty trailing line).
 */
function lineStartOffsets(content: string): number[] {
  const offsets = [0];
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

function greedyNonOverlapping(
  starts: readonly number[],
  window: number,
): number[] {
  const chosen: number[] = [];
  let next = 0;
  for (const start of starts) {
    if (start < next) continue;
    chosen.push(start);
    next = start + Math.max(window, 1);
  }
  return chosen;
}

function findLineWindows(
  haystackLines: readonly string[],
  needleLines: readonly string[],
  normalize: (line: string) => string,
): number[] {
  if (needleLines.length === 0) return [];
  if (needleLines.length > haystackLines.length) return [];
  const starts: number[] = [];
  const max = haystackLines.length - needleLines.length;
  for (let i = 0; i <= max; i += 1) {
    let ok = true;
    for (let j = 0; j < needleLines.length; j += 1) {
      const needleLine = needleLines[j]!;
      const haystackLine = haystackLines[i + j]!;
      // A trailing empty line from `split("\n")` is a newline boundary, not a
      // whitespace-tolerant blank. Only a real empty line may match it.
      if (needleLine === "") {
        if (haystackLine !== "") {
          ok = false;
          break;
        }
        continue;
      }
      if (normalize(haystackLine) !== normalize(needleLine)) {
        ok = false;
        break;
      }
    }
    if (ok) starts.push(i);
  }
  return starts;
}

/**
 * Character range for a line window. When the needle does not end with `\n`,
 * exclude the newline after the last matched line so replacement preserves
 * line boundaries the same way exact substring replace does.
 */
function windowCharRange(
  contentLf: string,
  offsets: readonly number[],
  startLine: number,
  needleLineCount: number,
  needleEndsWithNewline: boolean,
): { start: number; end: number } {
  const start = offsets[startLine]!;
  if (needleEndsWithNewline) {
    const endLine = startLine + needleLineCount;
    const end =
      endLine >= offsets.length ? contentLf.length : offsets[endLine]!;
    return { start, end };
  }
  const lastLine = startLine + needleLineCount - 1;
  const nextLineStart =
    lastLine + 1 >= offsets.length ? contentLf.length : offsets[lastLine + 1]!;
  let end = nextLineStart;
  if (end > start && contentLf[end - 1] === "\n") end -= 1;
  return { start, end };
}

function replaceLineWindows(
  contentLf: string,
  needleLines: readonly string[],
  newNorm: string,
  replaceAll: boolean,
  displayPath: string,
  tier: EditMatchTier,
  normalize: (line: string) => string,
): { content: string; replacements: number; matchTier: EditMatchTier } {
  const haystackLines = splitLines(contentLf);
  const starts = findLineWindows(haystackLines, needleLines, normalize);
  if (starts.length === 0) {
    throw new Error(
      `edit mismatch for ${displayPath}: old_content was not found on disk (normalize line endings / use a unique snippet)`,
    );
  }
  if (!replaceAll && starts.length > 1) {
    throw new EditAmbiguousError(
      `edit mismatch for ${displayPath}: old_content matched ${starts.length} times; provide a more specific snippet or set replace_all`,
    );
  }

  const offsets = lineStartOffsets(contentLf);
  const needleLineCount = needleLines.length;
  const needleEndsWithNewline =
    needleLines.length > 0 && needleLines[needleLines.length - 1] === "";
  // replace_all is greedy and non-overlapping. Overlapping hits stay in
  // `starts` so a non-replaceAll call still reports ambiguity.
  const chosen = replaceAll
    ? greedyNonOverlapping(starts, needleLineCount)
    : [starts[0]!];
  const parts: string[] = [];
  let cursor = 0;
  for (const startLine of chosen) {
    const { start, end } = windowCharRange(
      contentLf,
      offsets,
      startLine,
      needleLineCount,
      needleEndsWithNewline,
    );
    parts.push(contentLf.slice(cursor, start), newNorm);
    cursor = end;
  }
  parts.push(contentLf.slice(cursor));

  return {
    content: parts.join(""),
    replacements: chosen.length,
    matchTier: tier,
  };
}

function tryFuzzyTier(
  contentLf: string,
  needleLines: readonly string[],
  newNorm: string,
  replaceAll: boolean,
  displayPath: string,
  tier: EditMatchTier,
  normalize: (line: string) => string,
):
  | { content: string; replacements: number; matchTier: EditMatchTier }
  | undefined {
  const starts = findLineWindows(
    splitLines(contentLf),
    needleLines,
    normalize,
  );
  if (starts.length === 0) return undefined;
  return replaceLineWindows(
    contentLf,
    needleLines,
    newNorm,
    replaceAll,
    displayPath,
    tier,
    normalize,
  );
}

export function applyLiteralEdit(
  contentLf: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
  displayPath: string,
): { content: string; replacements: number; matchTier: EditMatchTier } {
  const oldNorm = normalizeLineEndings(oldString);
  if (oldNorm.length === 0) {
    throw new Error("old_content must be a non-empty string");
  }
  const newNorm = normalizeLineEndings(newString);

  // Tier 1: exact substring (after LF normalize).
  const exactCount = countOccurrences(contentLf, oldNorm);
  if (exactCount > 0) {
    if (!replaceAll && exactCount > 1) {
      throw new EditAmbiguousError(
        `edit mismatch for ${displayPath}: old_content matched ${exactCount} times; provide a more specific snippet or set replace_all`,
      );
    }
    return {
      content: contentLf.split(oldNorm).join(newNorm),
      replacements: exactCount,
      matchTier: "exact",
    };
  }

  const needleLines = splitLines(oldNorm);

  // Tier 2: per-line rstrip (trimEnd).
  const rstrip = tryFuzzyTier(
    contentLf,
    needleLines,
    newNorm,
    replaceAll,
    displayPath,
    "rstrip",
    (line) => line.trimEnd(),
  );
  if (rstrip) return rstrip;

  // Tier 3: per-line trim.
  const trim = tryFuzzyTier(
    contentLf,
    needleLines,
    newNorm,
    replaceAll,
    displayPath,
    "trim",
    (line) => line.trim(),
  );
  if (trim) return trim;

  throw new Error(
    `edit mismatch for ${displayPath}: old_content was not found on disk (normalize line endings / use a unique snippet)`,
  );
}

/** Strip CR so model-facing reads match LF edit space (DSH read-render). */
export function stripCarriageReturn(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
