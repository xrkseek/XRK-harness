import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createCuratedMemoryStore,
  extractReusableNotes,
  writeReusableNotesAfterTurn,
} from "../src/index.js";

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "xrk-memory-write-"));
}

describe("extractReusableNotes", () => {
  it("keeps explicit and stable user preferences", () => {
    const notes = extractReusableNotes({
      userText: [
        "remember: ship on Fridays",
        "What time is it?",
        "I prefer tabs in this repo.",
        "我习惯用 pnpm，不要换 npm。",
      ].join("\n"),
      assistantText: "I prefer to rewrite the whole tree.",
    });
    expect(notes).toEqual([
      "ship on Fridays",
      "I prefer tabs in this repo.",
      "我习惯用 pnpm，不要换 npm。",
    ]);
    expect(notes.join("\n")).not.toContain("rewrite");
  });

  it("redacts secrets and skips a turn that already called memory", () => {
    const redacted = extractReusableNotes({
      userText: "remember: the deploy token: sk-live-secretvalue is not for git",
    });
    expect(redacted[0]).toContain("[REDACTED_SECRET]");
    expect(redacted[0]).not.toContain("sk-live");
    expect(
      extractReusableNotes({
        userText: "remember: ship on Fridays",
        memoryToolWrote: true,
      }),
    ).toEqual([]);
  });
});

describe("writeReusableNotesAfterTurn", () => {
  it("appends MEMORY.md without changing the frozen prompt or touching mnemon", () => {
    const dir = tempDir();
    const store = createCuratedMemoryStore({ dir });
    const frozen = store.frozenSystemBlock();
    const result = writeReusableNotesAfterTurn(store, {
      userText: "remember: ci uses pnpm",
      assistantText: "ok",
    });
    expect(result.written).toEqual(["ci uses pnpm"]);
    expect(readFileSync(path.join(dir, "MEMORY.md"), "utf8")).toContain(
      "ci uses pnpm",
    );
    expect(store.frozenSystemBlock()).toBe(frozen);
    expect(dir).not.toMatch(/mnemon/);
    expect(store.dir).not.toMatch(/mnemon/);
  });

  it("writes nothing when the user did not state a reusable note", () => {
    const dir = tempDir();
    const store = createCuratedMemoryStore({ dir });
    const result = writeReusableNotesAfterTurn(store, {
      userText: "fix the failing test in this turn",
      assistantText: "done",
    });
    expect(result.written).toEqual([]);
  });
});
