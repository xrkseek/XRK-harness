import { describe, expect, it } from "vitest";
import {
  BoundedTextBuffer,
  splitUtf16Safe,
} from "../src/bounded-text-buffer.js";
import { clipUtf8Tail } from "../src/bytes.js";

/** Eager line-first then UTF-8-tail reference (DSH session-buffer.spec). */
function referenceTail(text: string, maxBytes: number) {
  if (Buffer.byteLength(text) <= maxBytes) return { text, truncated: false };
  const chars = Array.from(text);
  let bytes = 0;
  let start = chars.length;
  while (start > 0) {
    const size = Buffer.byteLength(chars[start - 1] as string);
    if (bytes + size > maxBytes) break;
    bytes += size;
    start -= 1;
  }
  return { text: chars.slice(start).join(""), truncated: true };
}

class ReferenceBuffer {
  private text = "";
  private truncated = false;

  constructor(
    private readonly maxBytes: number,
    private readonly maxLines?: number,
  ) {}

  append(chunk: string): void {
    if (chunk.length === 0) return;
    this.text += chunk;
    if (this.maxLines !== undefined) {
      const lines = this.text.split("\n");
      if (lines.length > this.maxLines) {
        this.text = lines.slice(-this.maxLines).join("\n");
        this.truncated = true;
      }
    }
    const bounded = referenceTail(this.text, this.maxBytes);
    this.text = bounded.text;
    this.truncated ||= bounded.truncated;
  }

  snapshot() {
    return { text: this.text, truncated: this.truncated };
  }
}

describe("BoundedTextBuffer", () => {
  it("retains the exact tail across a multi-MiB scrollback limit", () => {
    const limit = 256 * 1024;
    const buffer = new BoundedTextBuffer(limit);
    const chunk = "a".repeat(4096);
    for (let index = 0; index < limit / chunk.length; index += 1) {
      buffer.append(chunk);
    }
    expect(buffer.snapshot()).toEqual({
      text: "a".repeat(limit),
      truncated: false,
    });

    buffer.append("界😀TAIL");
    const retained = `${"a".repeat(limit - 11)}界😀TAIL`;
    expect(buffer.snapshot()).toEqual({ text: retained, truncated: true });
    expect(buffer.consume()).toEqual({ delta: retained, truncated: true });
    expect(buffer.consume()).toEqual({ delta: "", truncated: false });
  });

  it("counts trailing empty lines and keeps truncation sticky", () => {
    const buffer = new BoundedTextBuffer(64, 3);
    buffer.append("a\nb\n");
    expect(buffer.snapshot()).toEqual({
      text: "a\nb\n",
      truncated: false,
    });
    buffer.append("\n");
    expect(buffer.snapshot()).toEqual({
      text: "b\n\n",
      truncated: true,
    });
    buffer.append("");
    buffer.append("c");
    expect(buffer.snapshot().text).toBe("b\n\nc");
    expect(buffer.truncated).toBe(true);
  });

  it("bounds an oversized multibyte chunk without growing unbounded", () => {
    const buffer = new BoundedTextBuffer(11);
    buffer.append("abc");
    buffer.append("界😀éz");
    expect(buffer.snapshot().text).toBe("c界😀éz");
    expect(buffer.truncated).toBe(true);
    buffer.append("界😀".repeat(1000) + "éEND");
    expect(buffer.snapshot().text).toBe("😀éEND");
    expect(Buffer.byteLength(buffer.snapshot().text)).toBeLessThanOrEqual(11);
  });

  it("matches referenceTail for random ASCII/CJK streams", () => {
    const alphabet = ["a", "b", "\n", "界", "😀", "é"];
    let state = 0x12345678;
    const chunks = Array.from({ length: 200 }, () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return alphabet[state % alphabet.length] as string;
    });
    const maxBytes = 48;
    const maxLines = 8;
    const live = new BoundedTextBuffer(maxBytes, maxLines);
    const reference = new ReferenceBuffer(maxBytes, maxLines);
    for (const chunk of chunks) {
      live.append(chunk);
      reference.append(chunk);
      expect(live.snapshot()).toEqual(reference.snapshot());
    }
  });

  it("clipUtf8Tail still bounds a read page after retention", () => {
    const buffer = new BoundedTextBuffer(64, 10);
    buffer.append("line1\nline2\nline3\nline4\n");
    const page = buffer.snapshot().text.split("\n").slice(-2).join("\n");
    const bounded = clipUtf8Tail(page, 8);
    expect(bounded.truncated || Buffer.byteLength(bounded.text) <= 8).toBe(true);
  });

  it("splits oversized appends without pinning a giant string forever", () => {
    const buffer = new BoundedTextBuffer(64);
    // Larger than COALESCED_CHUNK_UNITS (4096) and far over maxBytes.
    buffer.append(`${"😀".repeat(3000)}TAIL`);
    const snap = buffer.snapshot();
    expect(snap.truncated).toBe(true);
    expect(snap.text.endsWith("TAIL")).toBe(true);
    expect(Buffer.byteLength(snap.text)).toBeLessThanOrEqual(64);
  });

  it("splitUtf16Safe keeps surrogate pairs intact", () => {
    const parts = splitUtf16Safe("a😀b", 2);
    expect(parts.join("")).toBe("a😀b");
    for (const part of parts) {
      for (let i = 0; i < part.length; i += 1) {
        const c = part.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
          expect(i + 1 < part.length).toBe(true);
          const low = part.charCodeAt(i + 1);
          expect(low >= 0xdc00 && low <= 0xdfff).toBe(true);
        }
      }
    }
  });

  it("maxBytes 0 retains nothing", () => {
    const buffer = new BoundedTextBuffer(0);
    buffer.append("hello");
    expect(buffer.snapshot()).toEqual({ text: "", truncated: true });
  });
});
