// @vitest-environment jsdom
// Durable transcript file cards (message-side twin of composer FileCard).

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { AttachmentId } from '@xrkseek/xrk-attachment'
import { MessageFileCard, MessageFileGallery } from '../src/MessageFileCard.tsx'

afterEach(cleanup)

const pdf = {
  attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`),
  name: 'notes.pdf',
  bytes: 2048,
  mediaType: 'application/pdf',
}

const txt = {
  attachmentId: AttachmentId(`sha256:${'c'.repeat(64)}`),
  name: 'readme',
  bytes: 12,
}

describe('MessageFileCard', () => {
  it('shows type glyph, basename, and extension+size meta', () => {
    const view = render(<MessageFileCard attachment={pdf} />)
    expect(view.getByText('notes.pdf')).toBeTruthy()
    expect(view.getByText('PDF 2.0KB')).toBeTruthy()
  })

  it('falls back gracefully when the name has no extension', () => {
    const view = render(<MessageFileCard attachment={txt} />)
    expect(view.getByText('readme')).toBeTruthy()
    expect(view.getByText('12B')).toBeTruthy()
  })
})

describe('MessageFileGallery', () => {
  it('renders nothing for an empty list', () => {
    const view = render(<MessageFileGallery files={[]} align="end" />)
    expect(view.container.firstChild).toBeNull()
  })

  it('renders one card per file with end alignment', () => {
    const view = render(
      <MessageFileGallery
        files={[{ attachment: pdf }, { attachment: txt }]}
        align="end"
      />,
    )
    expect(view.container.querySelector('[data-align="end"]')).toBeTruthy()
    expect(view.getByText('notes.pdf')).toBeTruthy()
    expect(view.getByText('readme')).toBeTruthy()
  })

  it('skips the gallery wrapper for a single file (inline attachment-row tile)', () => {
    const view = render(
      <MessageFileGallery files={[{ attachment: pdf }]} align="end" />,
    )
    expect(view.container.querySelector('[data-align="end"]')).toBeNull()
    expect(view.getByText('notes.pdf')).toBeTruthy()
  })
})
