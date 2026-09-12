import { describe, expect, it } from "vitest";
import { shouldFollowContentGrowth } from "../src/client/chat/follow-growth.ts";

describe("shouldFollowContentGrowth", () => {
  it("follows while pinned", () => {
    expect(
      shouldFollowContentGrowth({
        atBottom: true,
        distanceFromBottom: 80,
        growth: 40,
        threshold: 24,
      }),
    ).toBe(true);
  });

  it("re-pins when the only gap is sticky-dock growth", () => {
    expect(
      shouldFollowContentGrowth({
        atBottom: false,
        distanceFromBottom: 40,
        growth: 40,
        threshold: 24,
      }),
    ).toBe(true);
  });

  it("ignores growth while the reader is scrolled away", () => {
    expect(
      shouldFollowContentGrowth({
        atBottom: false,
        distanceFromBottom: 400,
        growth: 40,
        threshold: 24,
      }),
    ).toBe(false);
  });

  it("ignores shrink or zero growth when unpinned", () => {
    expect(
      shouldFollowContentGrowth({
        atBottom: false,
        distanceFromBottom: 10,
        growth: 0,
        threshold: 24,
      }),
    ).toBe(false);
  });
});
