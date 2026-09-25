/**
 * Plugin card field codecs (numberField / booleanField draft conversion).
 * Kept as *.test.ts so default vitest include picks it up.
 */
import { describe, expect, it } from "vitest";
import { booleanField, numberField } from "../src/client/field-codecs.ts";

describe("numberField draft codec", () => {
  const spec = numberField("maxSteps");

  it("renders a stored number and clears on empty", () => {
    expect(spec.format(32)).toBe("32");
    expect(spec.format(undefined)).toBe("");
  });

  it("parses numbers and rejects junk", () => {
    expect(spec.parse("12")).toEqual({ kind: "set", value: 12 });
    expect(spec.parse("")).toEqual({ kind: "clear" });
    expect(spec.parse("abc")).toBeUndefined();
    expect(spec.parse("NaN")).toBeUndefined();
  });
});

describe("booleanField draft codec", () => {
  const spec = booleanField("autoContinueOnMaxTokens");

  it("renders stored booleans", () => {
    expect(spec.format(true)).toBe("true");
    expect(spec.format(false)).toBe("false");
    expect(spec.format(undefined)).toBe("false");
  });

  it("parses both poles as explicit sets (never a silent clear)", () => {
    expect(spec.parse("true")).toEqual({ kind: "set", value: true });
    expect(spec.parse("false")).toEqual({ kind: "set", value: false });
  });

  it("rejects any other draft", () => {
    expect(spec.parse("yes")).toBeUndefined();
    expect(spec.parse("1")).toBeUndefined();
    expect(spec.parse("")).toBeUndefined();
  });
});
