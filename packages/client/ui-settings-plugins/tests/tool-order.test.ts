/**
 * Agent-loop toolOrder draft codec (comma list ↔ Face string[]).
 * Kept as *.test.ts so default vitest include picks it up.
 */
import { describe, expect, it } from "vitest";
import {
  formatToolOrder,
  parseToolOrder,
  TOOL_ORDER_REST,
} from "../src/client/tool-order-draft.ts";

describe("toolOrder draft codec", () => {
  it("formats rest as an empty comma slot", () => {
    expect(formatToolOrder(["bash", TOOL_ORDER_REST, "read_file"])).toBe(
      "bash, , read_file",
    );
    expect(formatToolOrder([])).toBe("");
    expect(formatToolOrder(undefined)).toBe("");
  });

  it("parses a rest slot and rejects bad drafts", () => {
    expect(parseToolOrder("bash, , read_file")).toEqual({
      kind: "set",
      value: ["bash", " ", "read_file"],
    });
    expect(parseToolOrder("")).toEqual({ kind: "clear" });
    expect(parseToolOrder("bash, read_file")).toBeUndefined();
    expect(parseToolOrder("bash, , bash")).toBeUndefined();
    expect(parseToolOrder(",")).toBeUndefined();
  });
});
