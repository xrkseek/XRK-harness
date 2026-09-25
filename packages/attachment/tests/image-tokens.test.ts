import { describe, expect, it } from "vitest";
import {
  estimateImageTokens,
  longEdgeDimensions,
  requestImageDimensions,
  requestImageTokenDimensions,
} from "../src/index.js";

describe("request projection", () => {
  it("keeps images under the pixel budget unchanged", () => {
    expect(requestImageDimensions(800, 600, 640_000)).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("scales to fit a hard pixel budget without enlarging", () => {
    expect(requestImageDimensions(2000, 2000, 640_000)).toEqual({
      width: 800,
      height: 800,
    });
  });

  it("longEdgeDimensions preserves aspect and never enlarges", () => {
    expect(longEdgeDimensions(8000, 40, 4096)).toEqual({
      width: 4096,
      height: 20,
    });
    expect(longEdgeDimensions(1080, 2400, 1862)).toEqual({
      width: 838,
      height: 1862,
    });
    expect(longEdgeDimensions(320, 240, 4096)).toEqual({
      width: 320,
      height: 240,
    });
  });
});

describe("DeepSeek V41 image tokens", () => {
  // Reference values from the provider's published image token calculator
  // (api-docs.deepseek.com, Token & Token Usage) in its v41 configuration.
  it.each([
    [100, 100, 184],
    [544, 544, 184],
    [640, 480, 206],
    [800, 800, 422],
    [1024, 768, 496],
    [1066, 600, 407],
    [1300, 1300, 994],
    [1920, 1080, 968],
    [2000, 2000, 994],
    [5000, 5000, 994],
    [300, 50, 200],
    [8192, 100, 593],
    [16, 8192, 590],
  ] as const)("prices %sx%s as %s tokens", (width, height, expected) => {
    expect(estimateImageTokens(width, height)).toBe(expected);
  });

  it("caps every image at 1024 tokens regardless of source size", () => {
    for (const [width, height] of [
      [2000, 2000],
      [5000, 5000],
      [8192, 8192],
      [16, 8192],
      [9000, 1],
      [1, 9000],
    ] as const) {
      expect(estimateImageTokens(width, height)).toBeLessThanOrEqual(1024);
    }
  });

  it("prices small images at the documented scale-up floor", () => {
    expect(estimateImageTokens(100, 100)).toBe(estimateImageTokens(544, 544));
  });

  it("solves extreme aspect ratios within the cap", () => {
    expect(estimateImageTokens(9000, 1)).toBe(1024);
    expect(estimateImageTokens(1, 9000)).toBe(1024);
  });

  it("converges through repeated projection passes", () => {
    expect(estimateImageTokens(12, 1123)).toBe(380);
    expect(estimateImageTokens(89, 2076)).toBe(254);
  });
});

describe("request image token dimensions", () => {
  it("can cross a token-cell boundary when preserving aspect", () => {
    const sent = requestImageTokenDimensions(1224, 1429);
    expect(sent).toEqual({ width: 1187, height: 1386 });
    expect(estimateImageTokens(1224, 1429)).toBe(959);
    expect(estimateImageTokens(sent.width, sent.height)).toBe(992);
  });

  it.each([
    [800, 800, 800, 800],
    [1302, 1302, 1302, 1302],
    [8192, 78, 8192, 78],
    [1, 9000, 1, 9000],
  ] as const)(
    "sends %sx%s unchanged when padded grid fits",
    (width, height, expectedWidth, expectedHeight) => {
      expect(requestImageTokenDimensions(width, height)).toEqual({
        width: expectedWidth,
        height: expectedHeight,
      });
    },
  );

  it.each([
    [1303, 1303, 1302, 1302],
    [2048, 2048, 1302, 1302],
    [2048, 1024, 1848, 924],
    [3840, 2160, 1708, 961],
    [1080, 2400, 838, 1862],
  ] as const)(
    "downscales %sx%s to %sx%s at the solved long edge",
    (width, height, expectedWidth, expectedHeight) => {
      const sent = requestImageTokenDimensions(width, height);
      expect(sent).toEqual({ width: expectedWidth, height: expectedHeight });
      expect(estimateImageTokens(sent.width, sent.height)).toBe(
        estimateImageTokens(width, height),
      );
    },
  );
});
