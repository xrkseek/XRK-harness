/**
 * `@xrkseek/spill` unit tests — locator · local store · policy.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applySpillPolicy,
  DEFAULT_SPILL_INLINE_BYTES,
  formatSpillNotice,
  LocalSpillStore,
  parseSpillLocator,
  resetDefaultLocalSpillStore,
  SpillLocator,
} from "../src/index.js";

let home: string | undefined;
let prevHome: string | undefined;

beforeEach(async () => {
  prevHome = process.env.XRK_HOME;
  home = await mkdtemp(path.join(tmpdir(), "xrk-spill-pkg-"));
  process.env.XRK_HOME = home;
  resetDefaultLocalSpillStore();
});

afterEach(async () => {
  resetDefaultLocalSpillStore();
  if (prevHome === undefined) delete process.env.XRK_HOME;
  else process.env.XRK_HOME = prevHome;
  if (home) await rm(home, { recursive: true, force: true }).catch(() => undefined);
  home = undefined;
});

describe("LocalSpillStore", () => {
  it("writes tool bodies under spill/tool-outputs and returns a locator", async () => {
    const store = new LocalSpillStore({ env: process.env });
    const ref = await store.saveText({
      owner: { sessionId: "sess-a" },
      source: {
        kind: "tool",
        toolName: "bash",
        callId: "call_1",
        label: "bash",
      },
      suggestedName: "out.txt",
      content: "hello-spill",
    });
    expect(String(ref.locator)).toContain(`${path.sep}spill${path.sep}tool-outputs${path.sep}`);
    expect(ref.bytes).toBeGreaterThan(0);
    expect(await readFile(String(ref.locator), "utf8")).toBe("hello-spill");
  });
});

describe("applySpillPolicy", () => {
  it("passes through small text", () => {
    const store = new LocalSpillStore({ env: process.env });
    const out = applySpillPolicy({
      sessionId: "s",
      callId: "c",
      toolName: "bash",
      plainText: "tiny",
      store,
    });
    expect(out.spilled).toBe(false);
    expect(out.content).toBe("tiny");
  });

  it("spills oversized bash output with notice + head/tail", () => {
    const store = new LocalSpillStore({ env: process.env });
    const fat = "A".repeat(DEFAULT_SPILL_INLINE_BYTES + 40_000);
    const out = applySpillPolicy({
      sessionId: "s-spill",
      callId: "call_fat",
      toolName: "bash",
      plainText: fat,
      store,
    });
    expect(out.spilled).toBe(true);
    expect(out.ref).toBeDefined();
    expect(out.content).toContain("Full formatted result stored at:");
    expect(out.content).toContain("Retrieve with read_file");
    expect(out.content).toContain("[... middle omitted ...]");
    expect(Buffer.byteLength(out.content, "utf8")).toBeLessThanOrEqual(
      DEFAULT_SPILL_INLINE_BYTES,
    );
  });

  it("skips read_file even when oversized", () => {
    const store = new LocalSpillStore({ env: process.env });
    const fat = "B".repeat(DEFAULT_SPILL_INLINE_BYTES + 10);
    const out = applySpillPolicy({
      sessionId: "s",
      callId: "c",
      toolName: "read_file",
      plainText: fat,
      store,
    });
    expect(out.spilled).toBe(false);
    expect(out.content).toBe(fat);
  });

  it("reuses savedPath without a second write", () => {
    const store = new LocalSpillStore({ env: process.env });
    const fat = "C".repeat(DEFAULT_SPILL_INLINE_BYTES + 10);
    const saved = path.join(home!, "spill", "tool-outputs", "pre.txt");
    const out = applySpillPolicy({
      sessionId: "s",
      callId: "c",
      toolName: "bash",
      plainText: fat,
      savedPath: saved,
      store,
    });
    expect(out.spilled).toBe(true);
    expect(String(out.ref?.locator)).toBe(saved);
    expect(out.content).toMatch(/^Full formatted result stored at:/);
  });
});

describe("parseSpillLocator / formatSpillNotice", () => {
  it("round-trips locator through notice text", () => {
    const ref = {
      locator: SpillLocator("/tmp/spill/tool-outputs/a.txt"),
      bytes: 12,
      retrievalHint: "Retrieve with read_file or grep on that path.",
    };
    const notice = formatSpillNotice({ omittedBytes: 100, ref });
    expect(parseSpillLocator(notice)).toBe("/tmp/spill/tool-outputs/a.txt");
  });

  it("parses pipeline marker", () => {
    expect(
      parseSpillLocator(
        "full content saved to /x/spill/tool-outputs/z.txt ...",
      ),
    ).toBe("/x/spill/tool-outputs/z.txt");
  });
});
