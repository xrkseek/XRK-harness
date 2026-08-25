/**
 * DSH-style literal edit: match in LF-normalized space, write back with the
 * original file's line endings.
 */

export type LineEndings = "LF" | "CRLF";

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

export function applyLiteralEdit(
  contentLf: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
  displayPath: string,
): { content: string; replacements: number } {
  const oldNorm = normalizeLineEndings(oldString);
  if (oldNorm.length === 0) {
    throw new Error("old_content must be a non-empty string");
  }
  const newNorm = normalizeLineEndings(newString);
  const replacements = countOccurrences(contentLf, oldNorm);
  if (replacements === 0) {
    throw new Error(
      `edit mismatch for ${displayPath}: old_content was not found on disk (normalize line endings / use a unique snippet)`,
    );
  }
  if (!replaceAll && replacements > 1) {
    throw new EditAmbiguousError(
      `edit mismatch for ${displayPath}: old_content matched ${replacements} times; provide a more specific snippet or set replace_all`,
    );
  }
  return {
    content: contentLf.split(oldNorm).join(newNorm),
    replacements,
  };
}

/** Strip CR so model-facing reads match LF edit space (DSH read-render). */
export function stripCarriageReturn(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
