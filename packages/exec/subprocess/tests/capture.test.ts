import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendUtf8TailCap,
  StreamTailCollector,
  SUBPROCESS_CAPTURE_MAX_BYTES,
} from "../src/index.js";

describe("appendUtf8TailCap", () => {
  it("keeps short text intact", () => {
    expect(appendUtf8TailCap("ab", "cd", 100)).toBe("abcd");
  });

  it("marks truncation and keeps the UTF-8 tail", () => {
    const out = appendUtf8TailCap("", "a".repeat(400_000), 256);
    expect(out).toContain("[output truncated]");
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(256);
  });
});

describe("StreamTailCollector spill", () => {
  it("spills the complete stream when the in-memory tail overflows", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-spill-"));
    try {
      const col = new StreamTailCollector(64, "stdout", {
        maxBytes: 1_000_000,
        dir,
        onFailure: () => {
          throw new Error("spill should not fail");
        },
      });
      col.push("head-");
      col.push("x".repeat(200));
      col.push("-tail");
      const out = col.finalize();
      expect(out.truncated).toBe(true);
      expect(out.spillPath).toBeTruthy();
      const full = await readFile(out.spillPath!, "utf8");
      expect(full).toBe(`head-${"x".repeat(200)}-tail`);
      expect(out.text).toContain("[output truncated]");
      expect(out.text.endsWith("-tail")).toBe(true);
      expect(Buffer.byteLength(out.text)).toBeLessThanOrEqual(64);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stays in memory under the cap without a spill file", () => {
    const col = new StreamTailCollector(SUBPROCESS_CAPTURE_MAX_BYTES, "stdout", {
      maxBytes: 1_000_000,
      dir: tmpdir(),
      onFailure: () => undefined,
    });
    col.push("small");
    const out = col.finalize();
    expect(out.truncated).toBe(false);
    expect(out.spillPath).toBeUndefined();
    expect(out.text).toBe("small");
  });
});
