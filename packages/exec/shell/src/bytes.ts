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

export function fitWithSuffix(
  content: string,
  suffix: string,
  maxBytes: number,
  omitted = "\n[output truncated]",
): string {
  const complete = `${content}${suffix}`;
  if (Buffer.byteLength(complete) <= maxBytes) return complete;
  const fixed = `${omitted}${suffix}`;
  const fixedBytes = Buffer.byteLength(fixed);
  if (fixedBytes >= maxBytes) return clipUtf8Tail(fixed, maxBytes).text;
  return `${clipUtf8Tail(content, maxBytes - fixedBytes).text}${fixed}`;
}
