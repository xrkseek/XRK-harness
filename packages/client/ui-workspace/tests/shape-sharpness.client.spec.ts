// @vitest-environment node
/**
 * Silhouette sharpness contract.
 *
 * The picker glyph is generated from `rings.js`, so a glyph can look correct
 * while the engine renders a soft blob (that is exactly how `star` turned into
 * a five-petal flower and `teardrop` into a plain circle). These assertions pin
 * the geometry itself:
 *
 *   - `star` / `star6` must have real spikes → outer/inner radius ratio ≥ 2.2
 *   - `drop` / `teardrop` must have a real point → three-point curvature radius
 *     at the tip < 4px (a rounded tip lands in the tens of px)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type Point = readonly [number, number]

const RINGS = fileURLToPath(
  new URL('../../../../apps/web/public/presence/emotion-ball/rings.js', import.meta.url),
)

const loadShapes = (): Record<string, { ring: Point[] }> => {
  const bag = globalThis as { EB_RINGS?: { SHAPES: Record<string, { ring: Point[] }> } }
  bag.EB_RINGS = undefined
  // rings.js is a classic browser script that assigns globalThis.EB_RINGS.
  // eslint-disable-next-line no-new-func
  new Function(readFileSync(RINGS, 'utf8'))()
  const shapes = bag.EB_RINGS?.SHAPES
  if (!shapes) throw new Error('rings.js did not expose EB_RINGS.SHAPES')
  return shapes
}

const SHAPES = loadShapes()

/** max/min distance from the ring centroid — 1 for a circle, ≫ 1 for a spike. */
function radiusRatio(ring: readonly Point[]): number {
  let cx = 0
  let cy = 0
  for (const [x, y] of ring) {
    cx += x
    cy += y
  }
  cx /= ring.length
  cy /= ring.length
  let min = Number.POSITIVE_INFINITY
  let max = 0
  for (const [x, y] of ring) {
    const r = Math.hypot(x - cx, y - cy)
    if (r < min) min = r
    if (r > max) max = r
  }
  return max / min
}

/** Circumradius of the tip and its two ring neighbours (0 when collinear). */
function tipCurvatureRadius(ring: readonly Point[]): number {
  let best = 0
  for (let i = 1; i < ring.length; i += 1) {
    if (ring[i][1] < ring[best][1]) best = i
  }
  const prev = ring[(best + ring.length - 1) % ring.length]
  const tip = ring[best]
  const next = ring[(best + 1) % ring.length]
  const a = Math.hypot(tip[0] - prev[0], tip[1] - prev[1])
  const b = Math.hypot(next[0] - tip[0], next[1] - tip[1])
  const c = Math.hypot(next[0] - prev[0], next[1] - prev[1])
  const area = Math.abs(
    (tip[0] - prev[0]) * (next[1] - prev[1]) - (next[0] - prev[0]) * (tip[1] - prev[1]),
  ) / 2
  if (area < 1e-9) return 0
  return (a * b * c) / (4 * area)
}

describe('silhouette sharpness', () => {
  it.each(['star', 'star6'])('%s has spikes, not petals', (id) => {
    const ring = SHAPES[id]?.ring
    expect(ring, `${id} missing`).toBeDefined()
    expect(ring.length, `${id} needs explicit vertices`).toBeGreaterThanOrEqual(10)
    expect(radiusRatio(ring)).toBeGreaterThanOrEqual(2.2)
  })

  it.each(['star', 'star6'])('%s samples land on the spike tips', (id) => {
    const ring = SHAPES[id].ring
    let cx = 0
    let cy = 0
    for (const [x, y] of ring) {
      cx += x
      cy += y
    }
    cx /= ring.length
    cy /= ring.length
    // The topmost point must BE an outer vertex: a polar sweep that misses the
    // tips leaves the local radius below the global max.
    let best = 0
    for (let i = 1; i < ring.length; i += 1) {
      if (ring[i][1] < ring[best][1]) best = i
    }
    const tipR = Math.hypot(ring[best][0] - cx, ring[best][1] - cy)
    let maxR = 0
    for (const [x, y] of ring) maxR = Math.max(maxR, Math.hypot(x - cx, y - cy))
    expect(tipR).toBeGreaterThan(maxR * 0.995)
  })

  it.each(['drop', 'teardrop'])('%s ends in a real cusp (<4px)', (id) => {
    const ring = SHAPES[id]?.ring
    expect(ring, `${id} missing`).toBeDefined()
    expect(tipCurvatureRadius(ring)).toBeLessThan(4)
  })

  it('teardrop is not a round blob (height/width ≥ 1.5)', () => {
    const ring = SHAPES.teardrop.ring
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const [x, y] of ring) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    expect((maxY - minY) / (maxX - minX)).toBeGreaterThanOrEqual(1.5)
  })
})
