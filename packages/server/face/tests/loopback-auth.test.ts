import { describe, expect, it } from "vitest";
import {
  isLoopbackAddress,
  timingSafeStringEqual,
} from "../src/wire/loopback.js";

describe("timingSafeStringEqual", () => {
  it("accepts equal strings", () => {
    expect(timingSafeStringEqual("abc", "abc")).toBe(true);
  });

  it("rejects unequal strings and length mismatch without throwing", () => {
    expect(timingSafeStringEqual("abc", "abd")).toBe(false);
    expect(timingSafeStringEqual("abc", "ab")).toBe(false);
    expect(timingSafeStringEqual(undefined, "x")).toBe(false);
    expect(timingSafeStringEqual("x", undefined)).toBe(false);
  });
});

describe("isLoopbackAddress", () => {
  it("recognizes common loopback forms", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("10.0.0.1")).toBe(false);
  });
});
