import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createCuratedMemoryLiveGate,
  createCuratedMemoryStore,
  formatCuratedMemoryLiveBody,
} from "../src/index.js";

function tempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `xrk-mem-live-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("curated memory live fragment gate", () => {
  it("formats a live body from disk and skips empty stores", () => {
    const dir = tempDir();
    expect(formatCuratedMemoryLiveBody(createCuratedMemoryStore({ dir }))).toBe(
      "",
    );
    writeFileSync(path.join(dir, "MEMORY.md"), "prefer tabs", "utf8");
    const store = createCuratedMemoryStore({ dir });
    const body = formatCuratedMemoryLiveBody(store);
    expect(body).toMatch(/^LIVE curated memory/);
    expect(body).toContain("prefer tabs");
  });

  it("turn-start always injects; post-tool only when the body changes", () => {
    const dir = tempDir();
    const store = createCuratedMemoryStore({ dir });
    const gate = createCuratedMemoryLiveGate(store);
    expect(gate.turnStart()).toBeUndefined();
    expect(gate.postTool()).toBeUndefined();

    expect(store.add("memory", "ship on Fridays").success).toBe(true);
    const first = gate.turnStart();
    expect(first).toContain("ship on Fridays");
    // Unchanged disk → post-tool silent (no log spam / no false cache churn).
    expect(gate.postTool()).toBeUndefined();

    expect(store.add("memory", "prefer dark theme").success).toBe(true);
    const afterWrite = gate.postTool();
    expect(afterWrite).toContain("prefer dark theme");
    expect(afterWrite).toContain("ship on Fridays");
    expect(gate.postTool()).toBeUndefined();
  });

  it("sees another session's write on the next turn-start", () => {
    const dir = tempDir();
    const a = createCuratedMemoryStore({ dir });
    const b = createCuratedMemoryStore({ dir });
    const gateA = createCuratedMemoryLiveGate(a);
    expect(a.add("memory", "from A").success).toBe(true);
    expect(gateA.turnStart()).toContain("from A");

    expect(b.add("memory", "from B").success).toBe(true);
    // A's gate still has lastFp=from-A-only; turn-start re-reads disk.
    const next = gateA.turnStart();
    expect(next).toContain("from A");
    expect(next).toContain("from B");
  });
});
