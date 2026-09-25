/**
 * Hermes-style region crop via sharp — applied before normalize/downscale.
 */
import {
  AttachmentError,
  clampImageRegion,
  type CroppedImageRegion,
  type ImageRegion,
} from '@xrkseek/attachment'
import { getSharp } from './sharp-module.js'

/**
 * Crop encoded image bytes to `[x1,y1,x2,y2]` in EXIF-oriented pixel space.
 * Re-encodes as PNG so the crop keeps a lossless raster for later normalize.
 */
export async function cropImageRegion(
  data: Uint8Array,
  region: ImageRegion,
): Promise<CroppedImageRegion> {
  try {
    const sharp = await getSharp()
    // Auto-orient so coordinates match perceived axes (same as admission detect).
    const oriented = sharp(data, { failOn: 'error', limitInputPixels: false }).rotate()
    const metadata = await oriented.metadata()
    const width = metadata.width
    const height = metadata.height
    if (
      width === undefined ||
      height === undefined ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE')
    }
    const clamped = clampImageRegion(region, width, height)
    if ('error' in clamped) {
      throw new AttachmentError(clamped.error, 'INVALID_IMAGE_REGION')
    }
    const { data: cropped, info } = await oriented
      .extract({
        left: clamped.left,
        top: clamped.top,
        width: clamped.width,
        height: clamped.height,
      })
      .png()
      .toBuffer({ resolveWithObject: true })
    return {
      data: new Uint8Array(cropped),
      mediaType: 'image/png',
      offset: { x: clamped.left, y: clamped.top },
      sourceSize: { width, height },
      cropSize: { width: info.width, height: info.height },
    }
  } catch (error) {
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError(
      `Failed to crop region: ${error instanceof Error ? error.message : String(error)}`,
      'INVALID_IMAGE',
      { cause: error },
    )
  }
}
