/** Pure transform helpers for the QQ-style ImageLightbox stage. */

export interface StageSize {
  readonly width: number
  readonly height: number
}

export interface NaturalSize {
  readonly width: number
  readonly height: number
}

export interface PanZoom {
  readonly scale: number
  readonly x: number
  readonly y: number
}

/** Fit image inside the stage without upscaling past 1:1. */
export function fitScale(natural: NaturalSize, stage: StageSize): number {
  if (natural.width <= 0 || natural.height <= 0 || stage.width <= 0 || stage.height <= 0) {
    return 1
  }
  return Math.min(stage.width / natural.width, stage.height / natural.height, 1)
}

/**
 * Cap zoom so large images can leave fit (≈5×) but tiny icons cannot explode.
 * Always allow at least 1:1 when the fitted scale is below that.
 */
export function maxScaleFor(fit: number): number {
  if (!Number.isFinite(fit) || fit <= 0) return 5
  return Math.min(Math.max(fit * 5, 1), 5)
}

/** Minimum zoom: fitted size (no further shrink — keeps framing stable). */
export function minScaleFor(fit: number): number {
  if (!Number.isFinite(fit) || fit <= 0) return 1
  return fit
}

/** Clamp pan so the image never leaves an empty stage when it is larger than the viewport. */
export function clampPan(
  x: number,
  y: number,
  scale: number,
  natural: NaturalSize,
  stage: StageSize,
): { x: number; y: number } {
  const displayW = natural.width * scale
  const displayH = natural.height * scale
  const maxX = Math.max(0, (displayW - stage.width) / 2)
  const maxY = Math.max(0, (displayH - stage.height) / 2)
  return {
    x: Math.min(maxX, Math.max(-maxX, x)),
    y: Math.min(maxY, Math.max(-maxY, y)),
  }
}

/**
 * Zoom around a focal point expressed in stage coordinates (origin = stage centre).
 * Keeps the content under the focal point visually fixed.
 */
export function zoomAround(
  current: PanZoom,
  nextScale: number,
  focalX: number,
  focalY: number,
  natural: NaturalSize,
  stage: StageSize,
): PanZoom {
  const fit = fitScale(natural, stage)
  const scale = Math.min(maxScaleFor(fit), Math.max(minScaleFor(fit), nextScale))
  if (scale === current.scale) {
    const pan = clampPan(current.x, current.y, scale, natural, stage)
    return { scale, x: pan.x, y: pan.y }
  }
  const ratio = scale / current.scale
  const x = focalX - (focalX - current.x) * ratio
  const y = focalY - (focalY - current.y) * ratio
  const pan = clampPan(x, y, scale, natural, stage)
  return { scale, x: pan.x, y: pan.y }
}

/** Initial transform: centered, fitted. */
export function initialPanZoom(natural: NaturalSize, stage: StageSize): PanZoom {
  return { scale: fitScale(natural, stage), x: 0, y: 0 }
}

/** True when the displayed bitmap fits entirely inside the stage (no clip). */
export function fitsInStage(
  view: PanZoom,
  natural: NaturalSize,
  stage: StageSize,
  epsilon = 0.5,
): boolean {
  return natural.width * view.scale <= stage.width + epsilon
    && natural.height * view.scale <= stage.height + epsilon
}
