import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONSOLIDATE_REPORT_FILE,
  createCuratedMemoryStore,
  createCuratedMemoryTools,
  readConsolidateReport,
  runCuratedMemoryConsolidate,
  tryClaimConsolidateLease,
} from "../src/index.js";

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "xrk-memory-pipe-"));
}

describe("curated memory consolidate pipeline", () => {
  it("leases single-flight and writes a report sidecar", async () => {
    const dir = tempDir();
    const store = createCuratedMemoryStore({ dir });
    const first = tryClaimConsolidateLease("sess-a", { dir, ttlMs: 60_000 });
    expect(first.ok).toBe(true);
    const second = tryClaimConsolidateLease("sess-a", { dir, ttlMs: 60_000 });
    expect(second.ok).toBe(false);
    if (first.ok) first.release();

    const report = await runCuratedMemoryConsolidate({
      store,
      sessionId: "sess-a",
      userTexts: ["remember: ship builds on Fridays only"],
      providerKind: "file",
    });
    expect(report.skipped).toBeUndefined();
    expect(report.phase1Written).toBe(1);
    expect(report.phase2).toBe("skipped");
    expect(report.providerKind).toBe("file");

    const sidecar = readConsolidateReport(dir);
    expect(sidecar?.phase1Written).toBe(1);
    const raw = JSON.parse(
      readFileSync(path.join(dir, CONSOLIDATE_REPORT_FILE), "utf8"),
    ) as { sessionId: string };
    expect(raw.sessionId).toBe("sess-a");
  });

  it("busy lease skips a second pipeline without double-writing", async () => {
    const dir = tempDir();
    const store = createCuratedMemoryStore({ dir });
    const hold = tryClaimConsolidateLease("sess-b", { dir });
    expect(hold.ok).toBe(true);

    const busy = await runCuratedMemoryConsolidate({
      store,
      sessionId: "sess-b",
      userTexts: ["remember: never double write"],
      providerKind: "file",
    });
    expect(busy.skipped).toBe("busy");
    expect(busy.phase1Written).toBe(0);
    const entries = await Promise.resolve(store.listEntries("memory"));
    expect(entries).toEqual([]);

    if (hold.ok) hold.release();
    const after = await runCuratedMemoryConsolidate({
      store,
      sessionId: "sess-b",
      userTexts: ["remember: never double write"],
    });
    expect(after.phase1Written).toBe(1);
  });

  it("memory list returns live entries", async () => {
    const dir = tempDir();
    const store = createCuratedMemoryStore({ dir });
    await Promise.resolve(store.add("memory", "I prefer tabs in this repo."));
    const [tool] = createCuratedMemoryTools(store);
    const out = await tool!.execute({ action: "list", target: "memory" });
    expect(out.isError).not.toBe(true);
    const body = JSON.parse(String(out.content)) as {
      entry_count: number;
      current_entries: string[];
    };
    expect(body.entry_count).toBe(1);
    expect(body.current_entries[0]).toContain("tabs");
  });

  it("phase2Requested without complete reports no-llm", async () => {
    const dir = tempDir();
    const store = createCuratedMemoryStore({ dir });
    const report = await runCuratedMemoryConsolidate({
      store,
      sessionId: "sess-c",
      userTexts: ["remember: use pnpm for installs"],
      phase2Requested: true,
    });
    expect(report.phase1Written).toBe(1);
    expect(report.phase2).toBe("no-llm");
  });
});
