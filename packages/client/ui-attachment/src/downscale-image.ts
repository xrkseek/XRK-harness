/**
 * Raster downscaling for message thumbnails.
 *
 * Historical attachments arrive as the original blob: a phone photo is
 * 12–48 MB once decoded, and a chat list that paints a few dozen of those
 * into 64px tiles is what tips a mobile renderer into OOM. Shrinking each
 * raster to a 480px long edge before it ever reaches an `<img>` keeps the
 * steady-state cost at ~0.9 MB per visible picture and makes the number
 * predictable instead of a function of what the model was shown.
 *
 * This stage is best-effort by design. A missing API, a cross-origin source,
 * or any throw returns `undefined`, and the caller keeps the original URL — a
 * blank thumbnail is never an acceptable failure mode (old iOS lacks
 * `createImageBitmap` entirely and must still render the full image).
 */

/** Long edge of a downscaled thumbnail bitmap: 2× the 240px single-image box. */
export const MESSAGE_IMAGE_BITMAP_EDGE = 480

/** Preferred encoding. Browsers that cannot encode it fall back to PNG on
 * their own (transparent sources stay transparent either way). */
const ENCODE_TYPE = 'image/webp'
const ENCODE_QUALITY = 0.85

/**
 * Re-encode one image source into a bounded object URL.
 *
 * The raster is decoded once, then copied into a canvas that caps its long
 * edge, so the pixel data that survives is the small one. The decode itself
 * cannot be avoided client-side — the bytes are already here.
 *
 * The cap is only ever applied downwards. A raster that already fits keeps
 * its original URL: upscaling a 100px icon to 480 would hand the frame a
 * `naturalWidth` it does not own, and the frame's own "the real raster is
 * bigger than the protocol said" promotion would blow the icon up to 240px of
 * blur.
 *
 * Note the flattening: an animated GIF (or APNG) thumbnail keeps its first
 * frame. That is the cheaper trade on a message list — the lightbox still
 * opens the original bytes, animation included.
 *
 * @param src - browser-readable image URL (`blob:`, `data:`, or a CORS-open `https:`).
 * @param maxEdge - long-edge cap of the produced bitmap.
 * @returns an object URL the caller owns and must revoke, or `undefined` to
 * fall back to `src`.
 */
export async function downscaleImageUrl(
  src: string,
  maxEdge: number = MESSAGE_IMAGE_BITMAP_EDGE,
): Promise<string | undefined> {
  if (
    typeof document === 'undefined'
    || typeof createImageBitmap !== 'function'
    || typeof URL.createObjectURL !== 'function'
  ) return undefined
  let bitmap: ImageBitmap | undefined
  try {
    const response = await fetch(src)
    if (!response.ok) return undefined
    const blob = await response.blob()
    // An HTML error page or a non-image attachment must not reach the canvas.
    if (blob.type !== '' && !blob.type.startsWith('image/')) return undefined
    bitmap = await createImageBitmap(blob)
    if (bitmap.width <= maxEdge && bitmap.height <= maxEdge) return undefined
    const scale = Math.min(maxEdge / bitmap.width, maxEdge / bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (context === null) return undefined
    // One pass from the decoded raster; `high` keeps a 4000px photo from
    // aliasing down to a 480px thumbnail.
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const shrunk = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, ENCODE_TYPE, ENCODE_QUALITY)
    })
    if (shrunk === null) return undefined
    return URL.createObjectURL(shrunk)
  } catch {
    // Any decode/encode gap lands here; the caller paints the original.
    return undefined
  } finally {
    bitmap?.close()
  }
}
