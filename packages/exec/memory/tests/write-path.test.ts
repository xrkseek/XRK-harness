import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENTRY_DELIMITER,
  MEMORY_CHAR_LIMIT,
  consolidateCuratedMemoryPhase1,
  consolidateCuratedMemoryPhase2,
  createCuratedMemoryStore,
  extractReusableNotes,
  noteCoveredByEntries,
  parsePhase2Notes,
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

describe("Phase2 LLM consolidate", () => {
  it("parsePhase2Notes accepts JSON arrays and bullet lines", () => {
    expect(parsePhase2Notes('["I prefer tabs in this repo."]')).toEqual([
      "I prefer tabs in this repo.",
    ]);
    expect(
      parsePhase2Notes("```json\n[\"always use pnpm for installs\"]\n```"),
    ).toEqual(["always use pnpm for installs"]);
    expect(parsePhase2Notes("- remember durable facts live here")).toEqual([
      "remember durable facts live here",
    ]);
  });

  it("consolidateCuratedMemoryPhase2 writes uncovered LLM notes", async () => {
    const dir = tempDir();
    const store = createCuratedMemoryStore({ dir });
    const result = await consolidateCuratedMemoryPhase2(store, {
      userTexts: ["We talked about shipping cadence and tool preferences."],
      complete: async () =>
        JSON.stringify([
          "Ship agent builds on Fridays only",
          "I prefer tabs in this repo.",
        ]),
    });
    expect(result.written).toEqual([
      "Ship agent builds on Fridays only",
      "I prefer tabs in this repo.",
    ]);
    expect(store.listEntries("memory")).toEqual(result.written);
  });

  it("Phase2 returns empty when complete fails (Phase1 still usable)", async () => {
    const dir = tempDir();
    const store = createCuratedMemoryStore({ dir });
    const phase2 = await consolidateCuratedMemoryPhase2(store, {
      userTexts: ["remember: keep the fallback path"],
      complete: async () => {
        throw new Error("llm down");
      },
    });
    expect(phase2.written).toEqual([]);
    const phase1 = await consolidateCuratedMemoryPhase1(store, {
      userTexts: ["remember: keep the fallback path"],
    });
    expect(phase1.written).toEqual(["keep the fallback path"]);
  });
});

describe("writeReusableNotesAfterTurn", () => {
  it("appends MEMORY.md without changing the frozen prompt or touching mnemon", async () => {
    const dir = tempDir();
    const store = createCuratedMemoryStore({ dir });
    const frozen = store.frozenSystemBlock();
    const result = await writeReusableNotesAfterTurn(store, {
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

  it("writes nothing when the user did not state a reusable note", async () => {
    const dir = tempDir();
    const store = createCuratedMemoryStore({ dir });
    const result = await writeReusableNotesAfterTurn(store, {
      userText: "fix the failing test in this turn",
      assistantText: "done",
    });
    expect(result.written).toEqual([]);
  });
});

describe("consolidateCuratedMemoryPhase1", () => {
  it("skips notes already covered on disk and appends leftovers", async () => {
    const dir = tempDir();
    const store = createCuratedMemoryStore({ dir });
    await Promise.resolve(store.add("memory", "ship on Fridays"));
    const frozen = store.frozenSystemBlock();
    const result = await consolidateCuratedMemoryPhase1(store, {
      userTexts: [
        "remember: ship on Fridays",
        "I prefer dark theme in this app forever.",
        "what is the weather?",
      ],
    });
    expect(result.written).toEqual([
      "I prefer dark theme in this app forever.",
    ]);
    const entries = await Promise.resolve(store.listEntries("memory"));
    expect(entries).toEqual([
      "ship on Fridays",
      "I prefer dark theme in this app forever.",
    ]);
    expect(store.frozenSystemBlock()).toBe(frozen);
    expect(noteCoveredByEntries("ship on Fridays", entries)).toBe(true);
  });

  it("soft-trims the oldest entry when the char cap blocks a new note", async () => {
    const dir = tempDir();
    const oldest = "stale bootstrap note here";
    const pad = "x".repeat(
      MEMORY_CHAR_LIMIT - oldest.length - ENTRY_DELIMITER.length - 20,
    );
    writeFileSync(
      path.join(dir, "MEMORY.md"),
      [oldest, pad].join(ENTRY_DELIMITER),
      "utf8",
    );
    const store = createCuratedMemoryStore({ dir });
    expect((await Promise.resolve(store.listEntries("memory"))).length).toBe(2);
    const result = await consolidateCuratedMemoryPhase1(store, {
      userTexts: ["remember: keep the release train on Tuesdays only"],
    });
    expect(result.written).toEqual(["keep the release train on Tuesdays only"]);
    const entries = await Promise.resolve(store.listEntries("memory"));
    expect(entries.some((e) => e.includes("release train"))).toBe(true);
    expect(entries).not.toContain(oldest);
  });
});
