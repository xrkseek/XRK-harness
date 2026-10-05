import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createCuratedMemoryStore,
  createCuratedMemoryTools,
  CURATED_MEMORY_PROMPT_TEXT,
  defaultCuratedMemoryDir,
  ENTRY_DELIMITER,
  USAGE_SIDECAR_FILE,
} from "../src/index.js";

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "xrk-memory-"));
}

function usageKey(entry: string): string {
  return createHash("sha256").update(entry).digest("hex").slice(0, 16);
}

function ageEntry(dir: string, entry: string, days: number): void {
  const file = path.join(dir, USAGE_SIDECAR_FILE);
  const usage = JSON.parse(readFileSync(file, "utf8")) as {
    entries: Record<string, number>;
  };
  usage.entries[usageKey(entry)] = Date.now() - days * 86_400_000;
  writeFileSync(file, JSON.stringify(usage), "utf8");
}

describe("curated memory store", () => {
  it("freezes MEMORY.md and USER.md and ignores later disk writes", () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "MEMORY.md"), "ship on Fridays", "utf8");
    writeFileSync(path.join(dir, "USER.md"), "name: Ada", "utf8");
    const store = createCuratedMemoryStore({ dir });
    const frozen = store.frozenSystemBlock();
    expect(frozen).toContain("ship on Fridays");
    expect(frozen).toContain("name: Ada");
    expect(frozen).toContain("MEMORY (durable facts across sessions");
    expect(frozen).toContain("USER PROFILE");
    expect(frozen).not.toContain("mnemon");

    const added = store.add("memory", "prefers tabs");
    expect(added.success).toBe(true);
    expect(readFileSync(path.join(dir, "MEMORY.md"), "utf8")).toContain("prefers tabs");
    expect(store.frozenSystemBlock()).toBe(frozen);
    expect(store.frozenSystemBlock()).not.toContain("prefers tabs");

    writeFileSync(
      path.join(dir, "MEMORY.md"),
      `ship on Fridays${ENTRY_DELIMITER}written behind the tool`,
      "utf8",
    );
    expect(store.frozenSystemBlock()).toBe(frozen);
  });

  it("replace and remove match a unique substring", () => {
    const dir = tempDir();
    const store = createCuratedMemoryStore({ dir });
    expect(store.add("user", "editor: vim").success).toBe(true);
    expect(store.add("user", "shell: fish").success).toBe(true);
    expect(store.replace("user", "vim", "editor: helix").success).toBe(true);
    expect(store.remove("user", "fish").success).toBe(true);
    const disk = readFileSync(path.join(dir, "USER.md"), "utf8");
    expect(disk).toBe("editor: helix");
    expect(disk).not.toContain("fish");
    expect(store.frozenPrompt("user")).toBe("");
  });

  it("rejects a second ambiguous match and an over-limit add", () => {
    const dir = tempDir();
    const store = createCuratedMemoryStore({ dir });
    store.add("memory", "alpha port 1");
    store.add("memory", "alpha port 2");
    const ambiguous = store.remove("memory", "alpha");
    expect(ambiguous.success).toBe(false);
    expect(ambiguous.error).toMatch(/Multiple entries/);
    const huge = store.add("memory", "x".repeat(3000));
    expect(huge.success).toBe(false);
    expect(huge.error).toMatch(/exceed/);
    expect(huge.current_entries?.length).toBe(2);
  });

  it("applies a batch atomically and refuses to wipe the file", () => {
    const dir = tempDir();
    const store = createCuratedMemoryStore({ dir });
    store.add("memory", "keep me");
    store.add("memory", "drop me");
    const wiped = store.applyBatch("memory", [
      { action: "remove", old_text: "keep" },
      { action: "remove", old_text: "drop" },
    ]);
    expect(wiped.success).toBe(false);
    expect(readFileSync(path.join(dir, "MEMORY.md"), "utf8")).toContain("keep me");

    const batch = store.applyBatch("memory", [
      { action: "remove", old_text: "drop me" },
      { action: "add", content: "new fact" },
    ]);
    expect(batch.success).toBe(true);
    const disk = readFileSync(path.join(dir, "MEMORY.md"), "utf8");
    expect(disk).toContain("keep me");
    expect(disk).toContain("new fact");
    expect(disk).not.toContain("drop me");
  });

  it("stores files under memories, not mnemon", () => {
    const dir = defaultCuratedMemoryDir({ XRK_HOME: path.join(tempDir(), "home") });
    expect(dir.replace(/\\/g, "/")).toMatch(/\/memories$/);
    expect(dir).not.toMatch(/mnemon/);
    const store = createCuratedMemoryStore({ dir });
    expect(store.dir).toBe(dir);
    expect(path.basename(path.dirname(dir))).not.toBe("mnemon");
  });
});

describe("curated memory isolation policy", () => {
  it("keeps MEMORY as durable facts, not a cross-session task queue", () => {
    expect(CURATED_MEMORY_PROMPT_TEXT).toMatch(/todo_write/);
    expect(CURATED_MEMORY_PROMPT_TEXT).toMatch(/not a standing plan/i);
    expect(CURATED_MEMORY_PROMPT_TEXT).toMatch(/Do not volunteer to resume/i);
    const [tool] = createCuratedMemoryTools(createCuratedMemoryStore({ dir: tempDir() }));
    expect(tool!.description).toMatch(/todo_write/);
    expect(tool!.description).toMatch(/Do NOT store session WIP/i);
  });
});

describe("memory hygiene (usage sidecar)", () => {
  it("ranks the longest-untouched entry first and offers it as a prune candidate", () => {
    const dir = tempDir();
    const store = createCuratedMemoryStore({ dir });
    const stale = "proxy is 127.0.0.1:7897 on this box";
    const fresh = "vitest filter goes after the file path";
    expect(store.add("memory", stale).success).toBe(true);
    expect(store.add("memory", fresh).success).toBe(true);
    ageEntry(dir, stale, 40);

    const ranked = store.staleEntries?.("memory");
    expect(ranked?.[0]?.entry).toBe(stale);
    expect(ranked?.[0]?.tracked).toBe(true);
    expect(ranked?.[0]?.ageDays).toBeGreaterThanOrEqual(40);

    const blocked = store.add("memory", "x".repeat(2400));
    expect(blocked.success).toBe(false);
    expect(blocked.prune_candidates?.[0]).toBe(stale);
  });

  it("falls back to file order when no entry has been tracked", () => {
    const dir = tempDir();
    writeFileSync(
      path.join(dir, "MEMORY.md"),
      `first fact${ENTRY_DELIMITER}second fact`,
      "utf8",
    );
    const store = createCuratedMemoryStore({ dir });
    expect(store.staleEntries?.("memory").map((item) => item.entry)).toEqual([
      "first fact",
      "second fact",
    ]);
  });

  it("surfaces stale entries through the memory tool list", async () => {
    const dir = tempDir();
    const store = createCuratedMemoryStore({ dir });
    const stale = "npm tarball uploads need the default fetch timeout";
    store.add("memory", stale);
    ageEntry(dir, stale, 12);
    const [tool] = createCuratedMemoryTools(store);
    const listed = await tool!.execute({ action: "list", target: "memory" });
    const payload = JSON.parse(String(listed.content)) as {
      stale_entries?: { entry: string; age_days: number | null }[];
    };
    expect(payload.stale_entries?.[0]?.entry).toBe(stale);
    expect(payload.stale_entries?.[0]?.age_days).toBeGreaterThanOrEqual(12);
  });
});

describe("memory tool", () => {
  it("add/replace/remove only, and the error is not a Mnemon path", async () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    const store = createCuratedMemoryStore({ dir });
    const [tool] = createCuratedMemoryTools(store);
    const added = await tool!.execute({
      action: "add",
      target: "memory",
      content: "ci uses pnpm",
    });
    expect(added.isError).toBe(false);
    expect(String(added.content)).toContain("Entry added");
    expect(String(added.content)).not.toContain("mnemon");
    expect(store.frozenSystemBlock()).toBe("");

    const replaced = await tool!.execute({
      action: "replace",
      target: "memory",
      old_text: "pnpm",
      new_text: "ci uses pnpm 11",
    });
    expect(replaced.isError).toBe(false);
    expect(readFileSync(path.join(dir, "MEMORY.md"), "utf8")).toContain("pnpm 11");

    const removed = await tool!.execute({
      action: "remove",
      target: "memory",
      old_text: "pnpm 11",
    });
    expect(removed.isError).toBe(false);
    expect(readFileSync(path.join(dir, "MEMORY.md"), "utf8")).toBe("");

    const search = await tool!.execute({ action: "search", target: "memory" });
    expect(search.isError).toBe(true);
    expect(String(search.content)).toMatch(/add, replace, remove/);
  });
});
