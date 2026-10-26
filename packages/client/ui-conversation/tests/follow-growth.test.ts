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
    expect(
      shouldFollowContentGrowth({
        atBottom: false,
        distanceFromBottom: 10,
        growth: -80,
        threshold: 24,
      }),
    ).toBe(false);
  });

  it("skips a no-op shrink write when already clamped to the floor", () => {
    // Browser already clamped; rewriting scrollTop mid sticky layout can hitch
    // the composer. viewArea min-height + hidden collapse keep the seat put.
    expect(
      shouldFollowContentGrowth({
        atBottom: true,
        distanceFromBottom: 0,
        growth: -120,
        threshold: 24,
      }),
    ).toBe(false);
  });

  it("re-pins shrink when scrollTop still sits past the new floor", () => {
    expect(
      shouldFollowContentGrowth({
        atBottom: true,
        distanceFromBottom: -80,
        growth: -120,
        threshold: 24,
      }),
    ).toBe(true);
  });
});
