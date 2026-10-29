import { describe, expect, it } from "vitest";
import { assertLosslessJson, isJsonValue, snapshotJsonValue } from "../src/json-value.js";

describe("lossless JSON", () => {
  it("snapshots plain trees and rejects Map/Date/BigInt/-0", () => {
    expect(snapshotJsonValue({ a: [1, "x", null, true] })).toEqual({
      a: [1, "x", null, true],
    });
    expect(isJsonValue({ a: 1 })).toBe(true);
    expect(snapshotJsonValue(new Map([["a", 1]]))).toBeUndefined();
    expect(snapshotJsonValue(new Date())).toBeUndefined();
    expect(snapshotJsonValue(1n)).toBeUndefined();
    expect(snapshotJsonValue(-0)).toBeUndefined();
    expect(snapshotJsonValue(Number.NaN)).toBeUndefined();
    expect(() => assertLosslessJson(new Set([1]), "event")).toThrow(
      /not losslessly JSON-serializable/,
    );
  });
});
