import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  boundToolResultContent,
  TOOL_RESULT_MAX_INLINE_BYTES,
} from "../src/tool-result-bound.js";

const spillFiles: string[] = [];
let prevHome: string | undefined;
let home: string | undefined;

beforeEach(async () => {
  prevHome = process.env.XRK_HOME;
  home = await mkdtemp(path.join(tmpdir(), "xrk-spill-bound-"));
  process.env.XRK_HOME = home;
});

afterEach(async () => {
  for (const file of spillFiles.splice(0)) {
    await rm(file, { force: true }).catch(() => undefined);
  }
  if (prevHome === undefined) delete process.env.XRK_HOME;
  else process.env.XRK_HOME = prevHome;
  if (home) await rm(home, { recursive: true, force: true }).catch(() => undefined);
  home = undefined;
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
    spillFiles.push(file);
    expect(file.replace(/\\/g, "/")).toMatch(/\/spill\/tool-outputs\//);
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
    spillFiles.push(match![1]!);
  });

  it("keeps the pipeline path and does not write a second file", () => {
    const saved = path.resolve("tmp", "already-full.txt");
    const marker =
      `HEAD\n\n... output truncated; full content saved to ${saved} ...\n\nTAIL`;
    const fat = marker + "Z".repeat(TOOL_RESULT_MAX_INLINE_BYTES);
    const out = boundToolResultContent({
      sessionId: `spill-reuse-${Date.now()}`,
      callId: "call_reuse",
      toolName: "bash",
      content: fat,
      maxInlineBytes: 800,
    });
    expect(out.spilled).toBe(true);
    const text = out.content as string;
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(800);
    const match = text.match(/stored at: (.+?)\. Retrieve/);
    expect(match?.[1]).toBe(saved);
    expect(text.replace(/\\/g, "/")).not.toContain("spill/tool-outputs");
  });

  it("prefers savedPath over a clipped marker (no second spill write)", async () => {
    const sessionId = `spill-savedpath-${Date.now()}`;
    const authoritative = path.join(home!, "spill", "tool-outputs", "real-full.txt");
    await mkdir(path.dirname(authoritative), { recursive: true });
    await writeFile(authoritative, "FULL_BODY_CONTENT", "utf8");
    spillFiles.push(authoritative);

    // Marker path clipped / missing trailing " ..." — regex alone would miss.
    const clipped =
      "HEAD\n\n... output truncated; full content saved to " +
      "Z".repeat(TOOL_RESULT_MAX_INLINE_BYTES);
    const before = await readdir(path.join(home!, "spill", "tool-outputs"));
    const out = boundToolResultContent({
      sessionId,
      callId: "call_clip",
      toolName: "bash",
      content: clipped,
      maxInlineBytes: 500,
      savedPath: authoritative,
    });
    expect(out.spilled).toBe(true);
    const text = out.content as string;
    expect(text).toContain(authoritative);
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(500);
    const after = await readdir(path.join(home!, "spill", "tool-outputs"));
    // No new session_call spill file — only the authoritative path's dir entry.
    expect(after.filter((n) => n.includes("call_clip"))).toEqual([]);
    expect(after.length).toBe(before.length);
    expect(await readFile(authoritative, "utf8")).toBe("FULL_BODY_CONTENT");
  });

  it("shares the same default byte ceiling as pipeline boundToolOutput", async () => {
    const { DEFAULT_TOOL_OUTPUT_MAX_BYTES } = await import(
      "@xrkseek/core-tools"
    );
    expect(TOOL_RESULT_MAX_INLINE_BYTES).toBe(DEFAULT_TOOL_OUTPUT_MAX_BYTES);
    expect(TOOL_RESULT_MAX_INLINE_BYTES).toBe(64_000);
  });
});
