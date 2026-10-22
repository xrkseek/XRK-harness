import { describe, expect, it } from "vitest";
import {
  CriticalPath,
  MAX_PATH_DEPTH,
  sumDurations,
} from "../src/critical-path.js";

describe("CriticalPath", () => {
  it("six kinds sum to the interval length", () => {
    const path = new CriticalPath();
    path.work("inference", 0, 40);
    path.work("tools", 40, 70);
    path.work("user_wait", 70, 100);
    const d = path.durations(0, 100);
    expect(sumDurations(d)).toBe(100);
    expect(d.inference).toBe(40);
    expect(d.tools).toBe(30);
    expect(d.user_wait).toBe(30);
  });

  it("parallel tools join without double-counting", () => {
    const a = new CriticalPath();
    a.work("inference", 0, 10);
    a.work("tools", 10, 50);
    const b = new CriticalPath();
    b.work("inference", 0, 10);
    b.work("tools", 10, 30);
    a.join(b);
    const d = a.durations(0, 50);
    expect(sumDurations(d)).toBe(50);
    expect(d.tools).toBe(40);
  });

  it("gaps become overhead", () => {
    const path = new CriticalPath();
    path.work("inference", 0, 10);
    path.work("tools", 20, 30);
    const d = path.durations(0, 30);
    expect(d.overhead).toBe(10);
    expect(sumDurations(d)).toBe(30);
  });

  it("depth overflow folds to unknown without throwing", () => {
    const path = new CriticalPath();
    for (let i = 0; i < MAX_PATH_DEPTH + 2; i += 1) {
      path.work("tools", i, i + 1);
    }
    const d = path.durations(0, MAX_PATH_DEPTH + 2);
    expect(d.unknown).toBeGreaterThan(0);
    expect(sumDurations(d)).toBe(MAX_PATH_DEPTH + 2);
  });
});
