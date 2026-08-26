import { describe, expect, it } from "vitest";
import {
  SESSION_CONTEXT_PROJECTION_KEYS,
  SESSION_HISTORY_PROJECTION_KEYS,
  historyPageIncludesProjections,
  sessionHistoryProjectionKeys,
  sessionHistoryTailProjectionKeys,
} from "../src/projections/snapshot-keys.js";

describe("sessionHistoryProjectionKeys", () => {
  it("tail keys include dsh-context projections", () => {
    const tail = sessionHistoryTailProjectionKeys();
    expect(tail).toEqual([
      ...SESSION_HISTORY_PROJECTION_KEYS,
      ...SESSION_CONTEXT_PROJECTION_KEYS,
    ]);
  });

  it("historyPageIncludesProjections is false for loadOlder", () => {
    expect(historyPageIncludesProjections(undefined)).toBe(true);
    expect(historyPageIncludesProjections(0)).toBe(false);
    expect(historyPageIncludesProjections(42)).toBe(false);
  });

  it("legacy helper omits dsh-context keys when beforeSeq is set", () => {
    const older = sessionHistoryProjectionKeys(42);
    expect(older).toEqual([...SESSION_HISTORY_PROJECTION_KEYS]);
    expect(older).not.toContain("contextTimeline");
  });
});
