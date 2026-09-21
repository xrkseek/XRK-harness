import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import {
  capSpillText,
  pruneSpillTree,
  SPILL_MAX_AGE_MS,
} from "../src/index.js";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("capSpillText", () => {
  it("leaves short text unchanged", () => {
    expect(capSpillText("hello", 100)).toBe("hello");
  });

  it("cuts on a UTF-8 boundary and marks the cap", () => {
    const text = "你".repeat(40);
    const out = capSpillText(text, 80);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(80);
    expect(out).toContain("capped at 80 bytes");
    expect(out.startsWith("你")).toBe(true);
  });
});

describe("pruneSpillTree", () => {
  it("drops aged files, then oldest until the total cap, and removes empty dirs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-spill-budget-"));
    dirs.push(root);
    const spill = path.join(root, "spill");
    const outputs = path.join(spill, "tool-outputs");
    const session = path.join(spill, "sess");
    mkdirSync(outputs, { recursive: true });
    mkdirSync(session, { recursive: true });

    const now = Date.now();
    const aged = path.join(outputs, "aged.txt");
    const oldest = path.join(outputs, "oldest.txt");
    const newer = path.join(outputs, "newer.txt");
    const transcript = path.join(session, "session-reference-1.txt");
    writeFileSync(aged, "a".repeat(50));
    writeFileSync(oldest, "b".repeat(80));
    writeFileSync(newer, "c".repeat(80));
    writeFileSync(transcript, "old-transcript");

    const day = 24 * 60 * 60 * 1000;
    utimesSync(aged, new Date(now - 8 * day), new Date(now - 8 * day));
    utimesSync(transcript, new Date(now - 8 * day), new Date(now - 8 * day));
    utimesSync(oldest, new Date(now - 2 * day), new Date(now - 2 * day));
    utimesSync(newer, new Date(now - 1 * day), new Date(now - 1 * day));

    pruneSpillTree(spill, { now, maxAgeMs: SPILL_MAX_AGE_MS, maxTotalBytes: 100 });

    expect(existsSync(aged)).toBe(false);
    expect(existsSync(transcript)).toBe(false);
    expect(existsSync(session)).toBe(false);
    expect(existsSync(oldest)).toBe(false);
    expect(existsSync(newer)).toBe(true);
    expect(existsSync(spill)).toBe(true);
  });
});
