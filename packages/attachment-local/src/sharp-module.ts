/** Lazy sharp loader — CLI must not crash at import when native bindings are absent. */

import { AttachmentError } from '@xrkseek/attachment'

export type { Sharp } from 'sharp'

type SharpModule = typeof import('sharp')

let sharpModule: SharpModule | undefined
let sharpLoadFailed: AttachmentError | undefined

export async function getSharpModule(): Promise<SharpModule> {
  if (sharpModule) return sharpModule
  if (sharpLoadFailed) throw sharpLoadFailed
  try {
    sharpModule = await import('sharp')
    return sharpModule
  } catch (cause) {
    sharpLoadFailed = new AttachmentError(
      'Image processing is unavailable: the sharp native module could not be loaded on this platform.',
      'ATTACHMENT_WRITE_FAILED',
      { cause },
    )
    throw sharpLoadFailed
  }
}

export async function getSharp(): Promise<SharpModule['default']> {
  return (await getSharpModule()).default
}
