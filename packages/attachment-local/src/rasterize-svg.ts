/** Decode SVG bytes to PNG for durable image admission. */

import { AttachmentError } from '@xrkseek/attachment'
import { getSharp } from './sharp-module.js'

const SVG_MAX_EDGE = 4096

/** True when the leading bytes look like an SVG document. */
export function looksLikeSvg(data: Uint8Array): boolean {
  if (data.byteLength < 4) return false
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(data.subarray(0, Math.min(data.byteLength, 256)))
    .trimStart()
    .toLowerCase()
  if (head.startsWith('<svg')) return true
  if (head.startsWith('<?xml') && head.includes('<svg')) return true
  return false
}

/** Render SVG to PNG pixels for {@link prepareImageFile} / saveImage. */
export async function rasterizeSvgToPng(data: Uint8Array): Promise<Uint8Array> {
  try {
    const sharp = await getSharp()
    const image = sharp(Buffer.from(data), {
      failOn: 'error',
      density: 144,
      limitInputPixels: false,
    })
    const meta = await image.metadata()
    const width = meta.width ?? 0
    const height = meta.height ?? 0
    if (width < 1 || height < 1) {
      throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE')
    }
    const longEdge = Math.max(width, height)
    const pipeline = longEdge > SVG_MAX_EDGE
      ? image.resize({
          width: width >= height ? SVG_MAX_EDGE : undefined,
          height: height > width ? SVG_MAX_EDGE : undefined,
          fit: 'inside',
          withoutEnlargement: true,
        })
      : image
    return new Uint8Array(await pipeline.png().toBuffer())
  } catch (error) {
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError('Unsupported or malformed image data.', 'INVALID_IMAGE', {
      cause: error,
    })
  }
}
