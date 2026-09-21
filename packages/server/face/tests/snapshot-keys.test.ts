import { describe, expect, it } from "vitest";
import {
  SESSION_CONTEXT_PROJECTION_KEYS,
  SESSION_HISTORY_PROJECTION_KEYS,
  historyPageIncludesProjections,
  sessionHistoryTailProjectionKeys,
} from "../src/projections/snapshot-keys.js";

describe("session history projection keys", () => {
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
});
