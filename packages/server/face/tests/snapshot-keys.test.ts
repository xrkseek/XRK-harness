import { describe, expect, it } from "vitest";
import {
  SESSION_CONTEXT_PROJECTION_KEYS,
  SESSION_HISTORY_PROJECTION_KEYS,
  sessionHistoryProjectionKeys,
} from "../src/projections/snapshot-keys.js";

describe("sessionHistoryProjectionKeys", () => {
  it("includes dsh-context keys on the tail page only", () => {
    const tail = sessionHistoryProjectionKeys(undefined);
    expect(tail).toEqual([
      ...SESSION_HISTORY_PROJECTION_KEYS,
      ...SESSION_CONTEXT_PROJECTION_KEYS,
    ]);
    expect(tail).toContain("contextTimeline");
    expect(tail).toContain("contextHeaders");
  });

  it("omits dsh-context keys on loadOlder pages", () => {
    const older = sessionHistoryProjectionKeys(42);
    expect(older).toEqual([...SESSION_HISTORY_PROJECTION_KEYS]);
    expect(older).not.toContain("contextTimeline");
    expect(older).not.toContain("contextHeaders");
  });
});
