import { describe, expect, it } from "vitest";
import { CONTROLLED_PROMPT, normalizeTerminalText, TerminalSanitizer } from "../src/sanitize.js";

describe("TerminalSanitizer", () => {
  it("removes split CSI and owned OSC prompt markers", () => {
    const sanitizer = new TerminalSanitizer(64);
    expect(sanitizer.push("red\x1b[3")).toEqual({ text: "red", prompt: false });
    expect(sanitizer.push("1m text\x1b[0m\r\n")).toEqual({ text: " text\n", prompt: false });
    expect(sanitizer.push("\x1b]133;")).toEqual({ text: "", prompt: false });
    expect(sanitizer.push(`D;0\x07${CONTROLLED_PROMPT}`)).toEqual({
      text: CONTROLLED_PROMPT,
      prompt: true,
      promptTail: CONTROLLED_PROMPT,
    });
  });

  it("drops unrelated OSC, short escapes, BEL, and incomplete trailing escape", () => {
    const sanitizer = new TerminalSanitizer(64);
    expect(sanitizer.push("a\x1b]0;title\x1b\\b\x1b7c\x07")).toEqual({
      text: "abc",
      prompt: false,
    });
    expect(sanitizer.push("tail\x1b")).toEqual({ text: "tail", prompt: false });
    expect(sanitizer.flush()).toBe("");
  });

  it("normalizes CRLF and standalone carriage returns", () => {
    expect(normalizeTerminalText("a\r\nb\rc\x07")).toBe("a\nb\nc");
  });

  it("reports printable prompt text that follows a marker in a later chunk", () => {
    const sanitizer = new TerminalSanitizer(64);
    expect(sanitizer.push("\x1b]133;D;0\x07")).toEqual({
      text: "",
      prompt: true,
      promptTail: "",
    });
    expect(sanitizer.push(CONTROLLED_PROMPT)).toEqual({
      text: CONTROLLED_PROMPT,
      prompt: false,
      promptTail: CONTROLLED_PROMPT,
    });
  });
});
