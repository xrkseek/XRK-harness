import { Buffer } from "node:buffer";
import type { TerminalSendRead } from "./types.js";

const COALESCED_CHUNK_UNITS = 4096;

interface TextChunk {
  text: string;
  start: number;
  next: TextChunk | undefined;
}

/**
 * Split on UTF-16 code-unit boundaries without breaking surrogate pairs
 * (so eviction byte accounting stays honest across chunk seams).
 */
export function splitUtf16Safe(text: string, maxUnits: number): string[] {
  if (maxUnits <= 0 || text.length <= maxUnits) return text.length === 0 ? [] : [text];
  const parts: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + maxUnits, text.length);
    if (end < text.length) {
      const prev = text.charCodeAt(end - 1);
      // High surrogate at the cut → keep the pair together.
      if (prev >= 0xd800 && prev <= 0xdbff) end -= 1;
    }
    if (end <= i) end = Math.min(i + 2, text.length);
    parts.push(text.slice(i, end));
    i = end;
  }
  return parts;
}

/**
 * Bounded scrollback / send-output ring (DSH terminal-bash BoundedTextBuffer).
 * Retention work is amortized over appends; reads assemble retained chunks.
 * Memory stays near `maxBytes` (+ one coalesced chunk) instead of growing then clipping.
 * Oversized appends are split so a single giant write cannot pin a multi-MiB
 * string until half of it is discarded.
 */
export class BoundedTextBuffer {
  private head: TextChunk | undefined;
  private tail: TextChunk | undefined;
  private bytes = 0;
  private newlines = 0;
  private lastCodeUnit = 0;
  private dropped = false;
  private readonly maxBytes: number;

  constructor(
    maxBytes: number,
    private readonly maxLines?: number,
  ) {
    // Non-positive → retain nothing (defensive; product configs validate > 0).
    this.maxBytes = Math.max(0, Math.floor(maxBytes));
  }

  get truncated(): boolean {
    return this.dropped;
  }

  get isEmpty(): boolean {
    return this.head === undefined;
  }

  append(text: string): void {
    if (text.length === 0) return;
    // Sanitized text can be a slice retaining discarded controls; copy UTF-16
    // without replacing lone surrogates.
    text = Buffer.from(text, "utf16le").toString("utf16le");
    if (text.length > COALESCED_CHUNK_UNITS) {
      for (const part of splitUtf16Safe(text, COALESCED_CHUNK_UNITS)) {
        this.appendPart(part);
      }
      return;
    }
    this.appendPart(text);
  }

  private appendPart(text: string): void {
    if (text.length === 0) return;
    this.bytes += Buffer.byteLength(text);
    const tail = this.tail;
    if (tail !== undefined) {
      const last = this.lastCodeUnit;
      const first = text.charCodeAt(0);
      // Concatenation can turn two three-byte lone surrogates into one four-byte code point.
      if (
        last >= 0xd800 &&
        last <= 0xdbff &&
        first >= 0xdc00 &&
        first <= 0xdfff
      ) {
        this.bytes -= 2;
      }
    }
    for (
      let index = text.indexOf("\n");
      index !== -1;
      index = text.indexOf("\n", index + 1)
    ) {
      this.newlines += 1;
    }
    this.lastCodeUnit = text.charCodeAt(text.length - 1);
    // The head never grows, so eviction never rescans a growing string.
    if (
      tail !== undefined &&
      tail !== this.head &&
      tail.text.length + text.length <= COALESCED_CHUNK_UNITS
    ) {
      tail.text += text;
    } else {
      if (tail !== undefined && tail.text.length <= COALESCED_CHUNK_UNITS) {
        // Copy coalesced fragments into one string; large tails already own storage.
        tail.text = Buffer.from(tail.text, "utf16le").toString("utf16le");
      }
      const chunk: TextChunk = { text, start: 0, next: undefined };
      if (tail === undefined) this.head = chunk;
      else tail.next = chunk;
      this.tail = chunk;
    }

    while (
      this.head !== undefined &&
      (this.bytes > this.maxBytes ||
        (this.maxLines !== undefined && this.newlines >= this.maxLines))
    ) {
      const head = this.head;
      const first = head.text.charCodeAt(head.start);
      const second =
        head.start + 1 < head.text.length
          ? head.text.charCodeAt(head.start + 1)
          : head.next?.text.charCodeAt(0);
      const paired =
        first >= 0xd800 &&
        first <= 0xdbff &&
        second !== undefined &&
        second >= 0xdc00 &&
        second <= 0xdfff;
      this.bytes -= paired ? 4 : first < 0x80 ? 1 : first < 0x800 ? 2 : 3;
      if (first === 10) this.newlines -= 1;
      this.advance(paired ? 2 : 1);
      this.dropped = true;
    }
    const head = this.head;
    if (head !== undefined && head.start >= head.text.length / 2) {
      // Copy UTF-16 verbatim so a small suffix cannot retain an oversized input's backing store.
      head.text = Buffer.from(head.text.slice(head.start), "utf16le").toString(
        "utf16le",
      );
      head.start = 0;
    }
  }

  private advance(units: number): void {
    while (units > 0 && this.head !== undefined) {
      const head = this.head;
      const count = Math.min(units, head.text.length - head.start);
      head.start += count;
      units -= count;
      if (head.start === head.text.length) this.head = head.next;
    }
    if (this.head === undefined) this.tail = undefined;
  }

  consume(): TerminalSendRead {
    const { text: delta, truncated } = this.snapshot();
    this.head = undefined;
    this.tail = undefined;
    this.bytes = 0;
    this.newlines = 0;
    this.dropped = false;
    return { delta, truncated };
  }

  snapshot(): { text: string; truncated: boolean } {
    const chunks: string[] = [];
    for (let chunk = this.head; chunk !== undefined; chunk = chunk.next) {
      chunks.push(chunk.text.slice(chunk.start));
    }
    return { text: chunks.join(""), truncated: this.dropped };
  }
}
