import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { AttachmentError, parseImageRegion } from '@xrkseek/attachment'
import { cropImageRegion } from '../src/crop-region.ts'

async function solidPng(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toBuffer(),
  )
}

describe('cropImageRegion', () => {
  it('crops to the requested box and reports offset', async () => {
    const src = await solidPng(100, 80)
    const region = parseImageRegion([10, 10, 60, 40])
    if ('error' in region) throw new Error(region.error)

    const cropped = await cropImageRegion(src, region)

    expect(cropped.mediaType).toBe('image/png')
    expect(cropped.offset).toEqual({ x: 10, y: 10 })
    expect(cropped.sourceSize).toEqual({ width: 100, height: 80 })
    expect(cropped.cropSize).toEqual({ width: 50, height: 30 })
    const meta = await sharp(cropped.data).metadata()
    expect(meta).toMatchObject({ width: 50, height: 30, format: 'png' })
  })

  it('clamps oversized regions to the image bounds', async () => {
    const src = await solidPng(50, 40)
    const region = parseImageRegion([-10, -10, 200, 200])
    if ('error' in region) throw new Error(region.error)

    const cropped = await cropImageRegion(src, region)
    expect(cropped.offset).toEqual({ x: 0, y: 0 })
    expect(cropped.cropSize).toEqual({ width: 50, height: 40 })
  })

  it('rejects inverted / zero-area regions with INVALID_IMAGE_REGION', async () => {
    const src = await solidPng(100, 80)
    const region = parseImageRegion([60, 40, 10, 10])
    if ('error' in region) throw new Error(region.error)

    await expect(cropImageRegion(src, region)).rejects.toMatchObject({
      name: 'AttachmentError',
      code: 'INVALID_IMAGE_REGION',
    } satisfies Partial<AttachmentError>)
  })
})
