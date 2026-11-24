// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ImageLightbox } from '../src/ImageLightbox.tsx'

afterEach(cleanup)

const labels = { dialog: '原图预览', close: '关闭原图预览', download: '下载原图' }

function loadNatural(img: HTMLImageElement, width: number, height: number): void {
  Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => width })
  Object.defineProperty(img, 'naturalHeight', { configurable: true, get: () => height })
  fireEvent.load(img)
}

describe('ImageLightbox', () => {
  it('focuses its close control, closes by button and Escape, and restores focus', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const onClose = vi.fn()
    const view = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={onClose} />)
    const close = view.getByRole('button', { name: '关闭原图预览' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(window, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('traps Tab between download and close controls', () => {
    const view = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={vi.fn()} />)
    const download = view.getByRole('button', { name: '下载原图' })
    const close = view.getByRole('button', { name: '关闭原图预览' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(download)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(close)
  })

  it('offers a download control that triggers an anchor click', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const view = render(<ImageLightbox src="blob:original" alt="shot" labels={labels} onClose={vi.fn()} />)
    fireEvent.click(view.getByRole('button', { name: '下载原图' }))
    expect(click).toHaveBeenCalled()
    click.mockRestore()
  })

  it('tolerates a focus owner it cannot restore (no active element at mount)', () => {
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => null })
    try {
      const view = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={vi.fn()} />)
      view.unmount()
    } finally {
      delete (document as { activeElement?: unknown }).activeElement
    }
  })

  it('zooms with Ctrl+wheel (non-passive native listener)', () => {
    const view = render(<ImageLightbox src="blob:original" alt="长图" labels={labels} onClose={vi.fn()} />)
    const img = view.getByRole('img') as HTMLImageElement
    const stage = document.querySelector('[data-image-lightbox-stage]') as HTMLElement
    Object.defineProperty(stage, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0, top: 0, right: 400, bottom: 700, width: 400, height: 700, x: 0, y: 0, toJSON: () => ({}),
      }),
    })
    loadNatural(img, 750, 4200)
    const before = img.style.transform
    fireEvent.wheel(stage, { deltaY: -120, ctrlKey: true, clientX: 200, clientY: 350 })
    expect(img.style.transform).not.toBe(before)
  })

  it('arms framing from a cached complete image without waiting for load', () => {
    const view = render(<ImageLightbox src="blob:cached" alt="cached.png" labels={labels} onClose={vi.fn()} />)
    const img = view.getByRole('img') as HTMLImageElement
    Object.defineProperty(img, 'complete', { configurable: true, get: () => true })
    Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => 320 })
    Object.defineProperty(img, 'naturalHeight', { configurable: true, get: () => 240 })
    view.rerender(<ImageLightbox src="blob:cached-2" alt="cached.png" labels={labels} onClose={vi.fn()} />)
    // src change re-reads complete bitmap; transform leaves pending (0,0,1) only when natural is 0.
    expect(img.style.transform).toContain('scale(')
  })
})
