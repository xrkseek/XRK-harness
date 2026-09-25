import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSqliteMemoryProvider,
  resolveMemoryProvider,
  type SqliteMemoryProvider,
} from "../src/index.js";

const temps: string[] = [];
const openProviders: SqliteMemoryProvider[] = [];

afterEach(() => {
  for (const p of openProviders.splice(0)) {
    try {
      p.close();
    } catch {
      /* ignore */
    }
  }
  for (const dir of temps.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows may keep a brief lock; leave for OS temp GC */
    }
  }
});

describe("sqlite MemoryProvider", () => {
  it("add / list / remove round-trip", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-mem-sqlite-"));
    temps.push(dir);
    const provider = createSqliteMemoryProvider({ dir });
    openProviders.push(provider);
    expect(provider.providerName).toBe("sqlite");
    expect(provider.isAvailable()).toBe(true);
    const added = provider.add("memory", "I prefer tabs in this repo.");
    expect(added.success).toBe(true);
    expect(provider.listEntries("memory")).toEqual([
      "I prefer tabs in this repo.",
    ]);
    const removed = provider.remove("memory", "prefer tabs");
    expect(removed.success).toBe(true);
    expect(provider.listEntries("memory")).toEqual([]);
  });

  it("resolveMemoryProvider accepts sqlite kind", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-mem-sqlite-r-"));
    temps.push(dir);
    const provider = resolveMemoryProvider({
      kind: "sqlite",
      sqlite: { dir },
    }) as SqliteMemoryProvider;
    openProviders.push(provider);
    expect(provider.providerName).toBe("sqlite");
  });
});
