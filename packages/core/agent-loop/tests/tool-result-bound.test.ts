import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  boundToolResultContent,
  TOOL_RESULT_MAX_INLINE_BYTES,
} from "../src/tool-result-bound.js";

const spillDirs: string[] = [];

afterEach(async () => {
  for (const dir of spillDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("boundToolResultContent", () => {
  it("passes through small plain text", () => {
    const out = boundToolResultContent({
      sessionId: "s1",
      callId: "c1",
      toolName: "bash",
      content: "hello",
    });
    expect(out.spilled).toBe(false);
    expect(out.content).toBe("hello");
  });

  it("spills oversized bash output with headTail preview + path", async () => {
    const sessionId = `spill-test-${Date.now()}`;
    const fat = "A".repeat(TOOL_RESULT_MAX_INLINE_BYTES + 50_000);
    const out = boundToolResultContent({
      sessionId,
      callId: "call_fat",
      toolName: "bash",
      content: fat,
    });
    expect(out.spilled).toBe(true);
    expect(typeof out.content).toBe("string");
    const text = out.content as string;
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(
      TOOL_RESULT_MAX_INLINE_BYTES,
    );
    expect(text).toMatch(/Full formatted result stored at:/);
    expect(text).toContain("middle omitted");
    const match = text.match(/stored at: (.+?)\. Retrieve/);
    expect(match?.[1]).toBeTruthy();
    const file = match![1]!;
    spillDirs.push(path.dirname(file));
    expect(await readFile(file, "utf8")).toBe(fat);
  });

  it("does not spill read_file (avoid read → spill → read)", () => {
    const fat = "B".repeat(TOOL_RESULT_MAX_INLINE_BYTES + 10_000);
    const out = boundToolResultContent({
      sessionId: "s-read",
      callId: "c-read",
      toolName: "read_file",
      content: fat,
    });
    expect(out.spilled).toBe(false);
    expect(out.content).toBe(fat);
  });

  it("maxInlineBytes 0 disables spill", () => {
    const fat = "C".repeat(TOOL_RESULT_MAX_INLINE_BYTES + 1_000);
    const out = boundToolResultContent({
      sessionId: "s-off",
      callId: "c-off",
      toolName: "bash",
      content: fat,
      maxInlineBytes: 0,
    });
    expect(out.spilled).toBe(false);
    expect(out.content).toBe(fat);
  });

  it("honors a custom maxInlineBytes ceiling", async () => {
    const sessionId = `spill-custom-${Date.now()}`;
    const fat = "D".repeat(5_000);
    const out = boundToolResultContent({
      sessionId,
      callId: "c-custom",
      toolName: "bash",
      content: fat,
      maxInlineBytes: 1_000,
    });
    expect(out.spilled).toBe(true);
    const text = out.content as string;
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(1_000);
    const match = text.match(/stored at: (.+?)\. Retrieve/);
    expect(match?.[1]).toBeTruthy();
    spillDirs.push(path.dirname(match![1]!));
  });
});
