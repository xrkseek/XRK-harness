import { Buffer } from "node:buffer";

export function clipUtf8Head(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
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
