/** Spill Status peek for overview browse. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { peekSpillEntry } from "../src/session-status.js";

describe("peekSpillEntry", () => {
  it("reads basename · bytes · preview from an on-disk spill", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-spill-peek-"));
    const file = path.join(dir, "s1_bash.txt");
    writeFileSync(file, "alpha\n".repeat(80), "utf8");
    const entry = peekSpillEntry(file, { tool: "bash", previewBudget: 120 });
    expect(entry.path).toBe(file);
    expect(entry.name).toBe("s1_bash.txt");
    expect(entry.tool).toBe("bash");
    expect(entry.bytes).toBeGreaterThan(100);
    expect(entry.preview).toBeTruthy();
    expect(entry.preview).toContain("…");
  });

  it("returns name-only when the file is missing", () => {
    const entry = peekSpillEntry("/no/such/spill-file-xyz.txt", {
      tool: "grep",
    });
    expect(entry.name).toBe("spill-file-xyz.txt");
    expect(entry.tool).toBe("grep");
    expect(entry.bytes).toBeUndefined();
    expect(entry.preview).toBeUndefined();
  });
});
