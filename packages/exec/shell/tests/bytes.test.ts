import { describe, expect, it } from "vitest";
import {
  clipUtf8Head,
  clipUtf8Tail,
  fitWithErrorHead,
  fitWithSuffix,
  STDERR_SECTION_MARKER,
} from "../src/bytes.js";

describe("clipUtf8Head / clipUtf8Tail", () => {
  it("passes content through within budget", () => {
    const text = "hello world";
    expect(clipUtf8Head(text, 1024)).toEqual({ text, truncated: false });
    expect(clipUtf8Tail(text, 1024)).toEqual({ text, truncated: false });
  });

  it("head keeps the start, tail keeps the end", () => {
    const text = "abcdefghij";
    expect(clipUtf8Head(text, 4)).toEqual({ text: "abcd", truncated: true });
    expect(clipUtf8Tail(text, 4)).toEqual({ text: "ghij", truncated: true });
  });

  it("never splits a multi-byte UTF-8 character", () => {
    const text = "a".repeat(10) + "中文中文" + "b".repeat(10);
    for (const clip of [clipUtf8Head, clipUtf8Tail]) {
      const out = clip(text, 12).text;
      // Re-encoding the cut text must not change it (no dangling surrogate bytes).
      expect(Buffer.from(out, "utf8").toString("utf8")).toBe(out);
      expect(Buffer.byteLength(out)).toBeLessThanOrEqual(12);
    }
  });

  it("zero budget yields empty", () => {
    expect(clipUtf8Head("hi", 0)).toEqual({ text: "", truncated: true });
    expect(clipUtf8Tail("hi", 0)).toEqual({ text: "", truncated: true });
  });
});

describe("fitWithSuffix", () => {
  it("returns the full content plus suffix within budget", () => {
    expect(fitWithSuffix("hello", "!", 100)).toBe("hello!");
  });

  it("tail-keeps over budget, keeping the suffix and the truncation marker", () => {
    const out = fitWithSuffix("abcdefghij".repeat(10), "!", 40);
    expect(out.endsWith("!")).toBe(true);
    expect(out).toContain("[output truncated]");
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(40);
  });
});

describe("fitWithErrorHead", () => {
  it("passes content through within budget", () => {
    const content = "ok\n[stderr]\nboom";
    expect(fitWithErrorHead(content, "!", 100)).toBe("ok\n[stderr]\nboom!");
  });

  it("keeps the stderr-section head plus a body tail for failed output", () => {
    const stdout = "echo-line\n".repeat(200);
    const stderr =
      "npm ERR! code E409\nnpm ERR! Cannot publish over previously staged version\n".repeat(20);
    const content = `${stdout}${STDERR_SECTION_MARKER}${stderr}`;
    const out = fitWithErrorHead(content, "[exit code: 1]", 240);
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(240);
    // The real error lives at the stderr-section head — it must survive.
    expect(out).toContain("npm ERR! code E409");
    expect(out).toContain("[stderr]");
    expect(out).toContain("[output truncated]");
    expect(out.endsWith("[exit code: 1]")).toBe(true);
  });

  it("degrades to head+tail when no stderr section is present", () => {
    const content = "start-of-output\n" + "pad-pad-pad\n".repeat(200) + "end-of-output";
    const out = fitWithErrorHead(content, "]", 80);
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(80);
    expect(out.startsWith("start-of-output")).toBe(true);
    expect(out.endsWith("]")).toBe(true);
  });
});