/**
 * Hermes / Qwen-style region crop: [x1, y1, x2, y2] in original-image pixels.
 * Applied before downscale so the crop keeps the full resolution budget.
 */

/** Inclusive-start exclusive-end box in original-image pixel coordinates. */
export type ImageRegion = readonly [x1: number, y1: number, x2: number, y2: number];

export interface ClampedImageRegion {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface CroppedImageRegion {
  readonly data: Uint8Array;
  /** Crop always re-encodes as PNG (Hermes / Pillow path). */
  readonly mediaType: "image/png";
  /** Top-left of the crop in the oriented source image. */
  readonly offset: { readonly x: number; readonly y: number };
  readonly sourceSize: { readonly width: number; readonly height: number };
  readonly cropSize: { readonly width: number; readonly height: number };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && !Number.isNaN(value);
}

/**
 * Parse a tool/wire `region` value into four pixel coordinates.
 * Rejects booleans (JSON schema quirk) and non-numeric entries.
 */
export function parseImageRegion(
  raw: unknown,
): ImageRegion | { readonly error: string } {
  if (!Array.isArray(raw) || raw.length !== 4) {
    return {
      error:
        "Invalid region: expected [x1, y1, x2, y2] as four numbers (pixel coordinates in the original image).",
    };
  }
  const values: number[] = [];
  for (const entry of raw) {
    if (typeof entry === "boolean" || !isFiniteNumber(entry)) {
      return {
        error:
          "Invalid region: expected [x1, y1, x2, y2] as four numbers (pixel coordinates in the original image).",
      };
    }
    values.push(entry);
  }
  return [values[0]!, values[1]!, values[2]!, values[3]!];
}

/**
 * Clamp a region to image bounds. Zero-area / inverted boxes after clamp are rejected.
 * Matches Hermes `_crop_image_region` (Pillow crop box semantics).
 */
export function clampImageRegion(
  region: ImageRegion,
  width: number,
  height: number,
): ClampedImageRegion | { readonly error: string } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return { error: "Invalid image dimensions for region crop." };
  }
  const [x1, y1, x2, y2] = region;
  const ix1 = Math.trunc(x1);
  const iy1 = Math.trunc(y1);
  const ix2 = Math.trunc(x2);
  const iy2 = Math.trunc(y2);
  const cx1 = Math.max(0, Math.min(ix1, width));
  const cy1 = Math.max(0, Math.min(iy1, height));
  const cx2 = Math.max(0, Math.min(ix2, width));
  const cy2 = Math.max(0, Math.min(iy2, height));
  if (cx2 <= cx1 || cy2 <= cy1) {
    return {
      error:
        `Invalid region [${ix1}, ${iy1}, ${ix2}, ${iy2}]: crops to zero ` +
        `area after clamping to the image bounds. The image is ` +
        `${width}x${height} px — pick x1<x2 and y1<y2 inside ` +
        `[0, 0, ${width}, ${height}].`,
    };
  }
  return {
    left: cx1,
    top: cy1,
    width: cx2 - cx1,
    height: cy2 - cy1,
  };
}
