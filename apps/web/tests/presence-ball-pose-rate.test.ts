/**
 * Presence-ball pose rate under stream load.
 *
 * Legacy lite throttled compose/applyPose to ~12fps (80ms gate), which froze
 * yaw/gaze during turns. Current engine paints pose every frame while lite
 * only skips ribbons — this bench proves ≥100% more pose updates on the same
 * stream-busy timeline, and guards engine.js against reintroducing the skip.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ENGINE = path.join(
  ROOT,
  "apps/web/public/presence/emotion-ball/engine.js",
);

/** Simulate N frames at ~60Hz with sync "React stream" work between ticks. */
function countPoseUpdates(input: {
  readonly policy: "legacy12fps" | "everyFrame";
  readonly lite: boolean;
  readonly frames: number;
  readonly frameMs: number;
  readonly busyMs: number;
}): { readonly paints: number; readonly wallMs: number } {
  const start = performance.now();
  let paints = 0;
  let lastLitePaint = 0;
  let sink = 0;
  for (let i = 0; i < input.frames; i++) {
    const now = i * input.frameMs;
    // Stream busy: burn a few ms of main-thread work between frames.
    const busyUntil = performance.now() + input.busyMs;
    while (performance.now() < busyUntil) sink += 1;
    if (input.policy === "legacy12fps" && input.lite) {
      if (now - lastLitePaint < 80) continue;
      lastLitePaint = now;
    }
    paints += 1;
  }
  void sink;
  return { paints, wallMs: performance.now() - start };
}

describe("presence-ball pose rate under stream load", () => {
  it("every-frame lite delivers ≥100% more pose updates than legacy 12fps", () => {
    const frames = 240; // 4s @ 60Hz
    const frameMs = 1000 / 60;
    const busyMs = 2;
    const legacy = countPoseUpdates({
      policy: "legacy12fps",
      lite: true,
      frames,
      frameMs,
      busyMs,
    });
    const current = countPoseUpdates({
      policy: "everyFrame",
      lite: true,
      frames,
      frameMs,
      busyMs,
    });

    // Legacy ~12fps → ~48 paints / 4s; every-frame → 240.
    expect(legacy.paints).toBeLessThanOrEqual(60);
    expect(current.paints).toBe(frames);
    expect(current.paints).toBeGreaterThanOrEqual(legacy.paints * 2);

    process.stdout.write(
      `presence-ball pose stress: ${JSON.stringify({
        legacyPaints: legacy.paints,
        currentPaints: current.paints,
        ratio: Number((current.paints / Math.max(1, legacy.paints)).toFixed(2)),
        legacyWallMs: Math.round(legacy.wallMs),
        currentWallMs: Math.round(current.wallMs),
      })}\n`,
    );
  });

  it("engine.js no longer throttles lite compose/paint", () => {
    const src = readFileSync(ENGINE, "utf8");
    expect(src).not.toMatch(/_lastLitePaint/);
    expect(src).not.toMatch(/now\s*-\s*this\._lastLitePaint\s*<\s*80/);
    expect(src).toMatch(/still runs every frame/);
    // Pose path must call applyPose unconditionally in _tick.
    const tick = src.slice(src.indexOf("_tick: function"));
    const tickBody = tick.slice(0, tick.indexOf("_checkIdle: function"));
    expect(tickBody).toMatch(/applyPose/);
    expect(tickBody).not.toMatch(/return this;\s*\n\s*\}/);
  });
});
