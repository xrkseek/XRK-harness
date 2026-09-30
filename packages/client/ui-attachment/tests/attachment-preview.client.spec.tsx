/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { ImageAttachmentRef } from '@xrkseek/xrk-attachment'
import { AttachmentPreview } from '../src/client/AttachmentPreview.tsx'

afterEach(() => {
  cleanup()
})

const labels = {
  'image.preview': 'preview',
  'image.closePreview': 'close',
  'image.download': 'download',
} as const

function t(key: keyof typeof labels): string {
  return labels[key]
}

describe('AttachmentPreview', () => {
  it('opens the lightbox after loadImage resolves', async () => {
    const attachment = {
      attachmentId: 'sha256:abc' as ImageAttachmentRef['attachmentId'],
      mediaType: 'image/png' as const,
      bytes: 1,
      width: 1,
      height: 1,
      name: 'shot.png',
    }
    const loadImage = vi.fn(async () => 'blob:preview')
    const onClose = vi.fn()
    render(
      <AttachmentPreview
        attachment={attachment}
        loadImage={loadImage}
        onClose={onClose}
        t={t as never}
      />,
    )
    await waitFor(() => {
      expect(document.querySelector('img[src="blob:preview"]')).toBeTruthy()
    })
    expect(loadImage).toHaveBeenCalledWith(attachment)
  })

  it('closes when loadImage rejects', async () => {
    const attachment = {
      attachmentId: 'sha256:dead' as ImageAttachmentRef['attachmentId'],
      mediaType: 'image/png' as const,
      bytes: 1,
      width: 1,
      height: 1,
    }
    const onClose = vi.fn()
    render(
      <AttachmentPreview
        attachment={attachment}
        loadImage={async () => { throw new Error('missing') }}
        onClose={onClose}
        t={t as never}
      />,
    )
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })
})
