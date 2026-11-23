import { describe, expect, it } from "vitest";
import { shouldVacuumFreelist } from "../src/sqlite-store.js";

describe("shouldVacuumFreelist", () => {
  const pageSize = 4096;
  const opts = { minFreeBytes: 16 * 1024 * 1024, minFreeRatio: 0.1 };

  it("passes on absolute free bytes alone (large DB, low ratio)", () => {
    // ~86MB free of ~1GB → ratio ~8.3%, used to fail AND gate
    const pageCount = 265_000;
    const freelist = Math.ceil((86 * 1024 * 1024) / pageSize);
    expect(shouldVacuumFreelist(freelist, pageCount, pageSize, opts)).toBe(true);
  });

  it("passes on ratio alone below absolute floor", () => {
    // ~14MB free at ~11% — used to fail minFreeBytes
    const pageCount = 31_054;
    const freelist = 3_532;
    expect(shouldVacuumFreelist(freelist, pageCount, pageSize, opts)).toBe(true);
  });

  it("rejects tiny freelist", () => {
    expect(shouldVacuumFreelist(10, 1000, pageSize, opts)).toBe(false);
  });
});
