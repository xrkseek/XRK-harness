/**
 * Golden track: spill
 * Oversized tool results spill under ~/.xrk/spill/tool-outputs; read_file stays inline.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  boundToolResultContent,
  TOOL_RESULT_MAX_INLINE_BYTES,
} from "@xrkseek/core-agent-loop";

const spillFiles: string[] = [];
let prevHome: string | undefined;
let home: string | undefined;

beforeEach(async () => {
  prevHome = process.env.XRK_HOME;
  home = await mkdtemp(path.join(tmpdir(), "xrk-eval-spill-"));
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

describe("golden/spill", () => {
  it("spills oversized bash output to spill/tool-outputs with recoverable path", async () => {
    const fat = "A".repeat(TOOL_RESULT_MAX_INLINE_BYTES + 40_000);
    const out = boundToolResultContent({
      sessionId: "eval-spill",
      callId: "call_fat",
      toolName: "bash",
      content: fat,
    });
    expect(out.spilled).toBe(true);
    const text = String(out.content);
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(
      TOOL_RESULT_MAX_INLINE_BYTES,
    );
    expect(text).toMatch(/Full formatted result stored at:/);
    const match = text.match(/stored at: (.+?)\. Retrieve/);
    expect(match?.[1]).toBeTruthy();
    const file = match![1]!;
    spillFiles.push(file);
    expect(file.replace(/\\/g, "/")).toMatch(/\/spill\/tool-outputs\//);
    expect(await readFile(file, "utf8")).toBe(fat);
  });

  it("keeps read_file inline (no read→spill→read loop)", () => {
    const fat = "B".repeat(TOOL_RESULT_MAX_INLINE_BYTES + 8_000);
    const out = boundToolResultContent({
      sessionId: "eval-spill-read",
      callId: "c-read",
      toolName: "read_file",
      content: fat,
    });
    expect(out.spilled).toBe(false);
    expect(out.content).toBe(fat);
  });
});
