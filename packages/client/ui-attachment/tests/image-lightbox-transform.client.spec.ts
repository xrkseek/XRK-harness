// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  clampPan,
  fitScale,
  fitsInStage,
  initialPanZoom,
  maxScaleFor,
  minScaleFor,
  zoomAround,
} from '../src/image-lightbox-transform.ts'

describe('image-lightbox-transform', () => {
  it('fits tall 长图 entirely inside the stage (no vertical clip)', () => {
    const natural = { width: 750, height: 4200 }
    const stage = { width: 390, height: 720 }
    const view = initialPanZoom(natural, stage)
    expect(fitScale(natural, stage)).toBeCloseTo(720 / 4200, 5)
    expect(fitsInStage(view, natural, stage)).toBe(true)
    expect(view.x).toBe(0)
    expect(view.y).toBe(0)
  })

  it('fits wide panoramas without horizontal clip', () => {
    const natural = { width: 6000, height: 400 }
    const stage = { width: 800, height: 600 }
    const view = initialPanZoom(natural, stage)
    expect(fitsInStage(view, natural, stage)).toBe(true)
    expect(view.scale).toBeCloseTo(800 / 6000, 5)
  })

  it('does not upscale a small square past 1:1', () => {
    const natural = { width: 64, height: 64 }
    const stage = { width: 800, height: 600 }
    expect(fitScale(natural, stage)).toBe(1)
    expect(fitsInStage(initialPanZoom(natural, stage), natural, stage)).toBe(true)
  })

  it('caps zoom so fit×5 never exceeds 5× absolute', () => {
    expect(maxScaleFor(1)).toBe(5)
    expect(maxScaleFor(0.1)).toBe(1)
    expect(minScaleFor(0.2)).toBe(0.2)
  })

  it('clamps pan so a zoomed tall image cannot leave empty stage gaps', () => {
    const natural = { width: 750, height: 4200 }
    const stage = { width: 390, height: 720 }
    const scale = fitScale(natural, stage) * 3
    const pan = clampPan(0, 10_000, scale, natural, stage)
    const displayH = natural.height * scale
    expect(Math.abs(pan.y)).toBeCloseTo((displayH - stage.height) / 2, 5)
    expect(pan.x).toBe(0)
  })

  it('re-clamps pan with the new scale after a stage shrink', () => {
    const natural = { width: 2000, height: 2000 }
    const wide = { width: 1000, height: 1000 }
    const narrow = { width: 400, height: 400 }
    const zoomed = { scale: 1, x: 900, y: 900 }
    const fit = fitScale(natural, narrow)
    const scale = Math.min(maxScaleFor(fit), Math.max(minScaleFor(fit), zoomed.scale))
    const pan = clampPan(zoomed.x, zoomed.y, scale, natural, narrow)
    const max = (2000 - 400) / 2
    expect(scale).toBe(1)
    expect(Math.abs(pan.x)).toBeCloseTo(max, 5)
    expect(Math.abs(pan.y)).toBeCloseTo(max, 5)
    expect(fitsInStage({ scale, ...pan }, natural, narrow)).toBe(false)
    expect(fitsInStage(initialPanZoom(natural, wide), natural, wide)).toBe(true)
  })

  it('zooms around a focal point without escaping the stage', () => {
    const natural = { width: 1000, height: 1000 }
    const stage = { width: 500, height: 500 }
    const start = initialPanZoom(natural, stage)
    const zoomed = zoomAround(start, start.scale * 2, 100, -50, natural, stage)
    expect(zoomed.scale).toBeCloseTo(1, 5)
    expect(fitsInStage(
      { scale: Math.min(zoomed.scale, fitScale(natural, stage)), x: 0, y: 0 },
      natural,
      stage,
    )).toBe(true)
    const pan = clampPan(zoomed.x, zoomed.y, zoomed.scale, natural, stage)
    expect(pan.x).toBe(zoomed.x)
    expect(pan.y).toBe(zoomed.y)
  })
})
