import { Buffer } from "node:buffer";

/** Tail-keep UTF-8 clip for job_output / completion notices (CV DSH TextRetainer). */
export function clipUtf8Tail(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  if (maxBytes <= 0) return { text: "", truncated: text.length > 0 };
  if (Buffer.byteLength(text) <= maxBytes) return { text, truncated: false };
  const chars = Array.from(text);
  let bytes = 0;
  let start = chars.length;
  while (start > 0) {
    const nextChar = chars[start - 1];
    if (nextChar === undefined) break;
    const next = Buffer.byteLength(nextChar);
    if (bytes + next > maxBytes) break;
    bytes += next;
    start -= 1;
  }
  return { text: chars.slice(start).join(""), truncated: true };
}

/**
 * Head-keep UTF-8 clip. Command errors (`Error:`, stack frames, `npm ERR!`)
 * live at the start of the output; this keeps that signal when a failed job's
 * output exceeds its budget.
 */
export function clipUtf8Head(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  if (maxBytes <= 0) return { text: "", truncated: text.length > 0 };
  if (Buffer.byteLength(text) <= maxBytes) return { text, truncated: false };
  const chars = Array.from(text);
  let bytes = 0;
  let end = 0;
  while (end < chars.length) {
    const nextChar = chars[end];
    if (nextChar === undefined) break;
    const next = Buffer.byteLength(nextChar);
    if (bytes + next > maxBytes) break;
    bytes += next;
    end += 1;
  }
  return { text: chars.slice(0, end).join(""), truncated: true };
}

export interface FitWithSuffixOptions {
  /**
   * Keep both the head and the tail of `content` (default false = tail-keep
   * only). Failed jobs lose their leading error text under a pure tail-keep,
   * so callers that know the job errored should pass this.
   */
  readonly keepHead?: boolean;
  /** Fraction of the content budget spent on the head when `keepHead` (default 0.5). */
  readonly headRatio?: number;
}

export function fitWithSuffix(
  content: string,
  suffix: string,
  maxBytes: number,
  omitted = "\n[output truncated]",
  opts: FitWithSuffixOptions = {},
): string {
  const complete = `${content}${suffix}`;
  if (Buffer.byteLength(complete) <= maxBytes) return complete;
  const fixed = `${omitted}${suffix}`;
  const fixedBytes = Buffer.byteLength(fixed);
  if (fixedBytes >= maxBytes) return clipUtf8Tail(fixed, maxBytes).text;
  const budget = maxBytes - fixedBytes;
  if (opts.keepHead !== true) {
    return `${clipUtf8Tail(content, budget).text}${fixed}`;
  }
  const ratio = opts.headRatio ?? 0.5;
  const head = clipUtf8Head(content, Math.max(1, Math.floor(budget * ratio)));
  const tail = clipUtf8Tail(content, budget - Buffer.byteLength(head.text));
  return `${head.text}${omitted}${tail.text}${suffix}`;
}

/**
 * Marker emitted by shell `readJobOutput` between stdout and the stderr
 * section of a settled job (see `readJobOutput` in the shell package).
 */
export const STDERR_SECTION_MARKER = "\n[stderr]\n";

/**
 * Error-head-fit for failed job output. Bash failures surface their real
 * error in the `[stderr]` section, which `readJobOutput` appends *after*
 * stdout — a plain head-keep of the whole body would save useless stdout
 * echoes and drop the error. This keeps the head of the stderr section
 * (first error line / stack head) plus a tail of the whole body (latest
 * lines, exit marker, status trailer).
 */
export function fitWithErrorHead(
  content: string,
  suffix: string,
  maxBytes: number,
  omitted = "\n[output truncated]",
  stderrHeadRatio = 0.6,
): string {
  const complete = `${content}${suffix}`;
  if (Buffer.byteLength(complete) <= maxBytes) return complete;
  const fixed = `${omitted}${suffix}`;
  const fixedBytes = Buffer.byteLength(fixed);
  if (fixedBytes >= maxBytes) return clipUtf8Tail(fixed, maxBytes).text;
  const budget = maxBytes - fixedBytes;
  const markerAt = content.lastIndexOf(STDERR_SECTION_MARKER);
  if (markerAt < 0) {
    // No structured stderr section (still-running / managed output): keep
    // head + tail of the whole body, errors may live at either end.
    return fitWithSuffix(content, suffix, maxBytes, omitted, { keepHead: true });
  }
  const headBudget = Math.max(1, Math.floor(budget * stderrHeadRatio));
  // Keep the `[stderr]` label so the retained head stays parseable.
  const head = clipUtf8Head(content.slice(markerAt), headBudget);
  const tailBudget = budget - Buffer.byteLength(head.text);
  const tail = clipUtf8Tail(content, tailBudget);
  return `${head.text}${omitted}${tail.text}${suffix}`;
}
