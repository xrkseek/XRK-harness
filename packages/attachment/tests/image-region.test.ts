import { describe, expect, it } from "vitest";
import {
  clampImageRegion,
  parseImageRegion,
} from "../src/image-region.js";

describe("parseImageRegion", () => {
  it("accepts four numbers", () => {
    expect(parseImageRegion([10, 20, 30, 40])).toEqual([10, 20, 30, 40]);
    expect(parseImageRegion([1.5, 2, 3, 4])).toEqual([1.5, 2, 3, 4]);
  });

  it("rejects wrong arity and non-numbers", () => {
    expect(parseImageRegion([1, 2, 3])).toMatchObject({ error: expect.stringContaining("four numbers") });
    expect(parseImageRegion([1, 2, 3, true])).toMatchObject({ error: expect.stringContaining("four numbers") });
    expect(parseImageRegion("nope")).toMatchObject({ error: expect.stringContaining("four numbers") });
  });
});

describe("clampImageRegion", () => {
  it("clamps to bounds and returns extract box", () => {
    expect(clampImageRegion([-10, -10, 200, 200], 100, 80)).toEqual({
      left: 0,
      top: 0,
      width: 100,
      height: 80,
    });
    expect(clampImageRegion([10, 10, 60, 40], 100, 80)).toEqual({
      left: 10,
      top: 10,
      width: 50,
      height: 30,
    });
  });

  it("rejects zero-area after clamp", () => {
    const bad = clampImageRegion([60, 40, 10, 10], 100, 80);
    expect(bad).toMatchObject({ error: expect.stringContaining("zero area") });
    expect(bad).toMatchObject({ error: expect.stringContaining("100x80") });
  });

  it("rejects a box entirely outside the image", () => {
    expect(clampImageRegion([200, 200, 300, 300], 100, 80)).toMatchObject({
      error: expect.stringContaining("zero area"),
    });
  });
});
