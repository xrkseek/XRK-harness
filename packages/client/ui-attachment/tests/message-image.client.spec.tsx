// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { AttachmentId } from '@xrkseek/xrk-attachment'
import type { MessageImagesProps } from '@xrkseek/client-ui-conversation/client'
import { ImageGallery, MessageImage } from '../src/MessageImage.tsx'
import type { MessageImageLabels } from '../src/MessageImage.tsx'
import { MessageImages } from '../src/client/MessageImages.tsx'

afterEach(cleanup)

const labels: MessageImageLabels = {
  image: '图片',
  open: '查看原图',
  openNamed: label => `${label}，点击查看原图`,
  loading: '图片加载中…',
  loadFailed: '图片加载失败，点击重试',
  lightbox: { dialog: '原图预览', close: '关闭原图预览' },
}

const attachment = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png' as const,
  bytes: 68,
  width: 640,
  height: 320,
  name: 'history.png',
}

describe('MessageImage', () => {
  it('loads a session-authorized URL, bounds the thumbnail, and clicks into the original', async () => {
    const load = vi.fn().mockResolvedValue('blob:history')
    const view = render(<MessageImage image={{ attachment }} load={load} variant="single" labels={labels} />)
    const frame = view.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(frame.getAttribute('style')).toContain('width: 240px')
    expect(frame.getAttribute('style')).toContain('height: 120px')
    expect(frame.getAttribute('title')).toBe('查看原图')
    await waitFor(() => { expect(view.getByAltText('history.png')).toBeTruthy() })
    expect(load).toHaveBeenCalledWith(attachment)
    fireEvent.click(frame)
    expect(view.getByRole('dialog', { name: '原图预览' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '关闭原图预览' }))
    expect(view.queryByRole('dialog', { name: '原图预览' })).toBeNull()
  })

  it('ignores a click while the thumbnail is still loading', () => {
    const load = vi.fn(() => new Promise<string>(() => {}))
    const view = render(<MessageImage image={{ attachment }} load={load} variant="single" labels={labels} />)
    const frame = view.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(view.getByText('图片加载中…')).toBeTruthy()
    fireEvent.click(frame)
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('falls back to the image label for an unnamed attachment', async () => {
    const { name: _named, ...unnamed } = attachment
    const load = vi.fn().mockResolvedValue('blob:unnamed')
    const view = render(<MessageImage image={{ attachment: unnamed }} load={load} variant="single" labels={labels} />)
    await waitFor(() => { expect(view.getByAltText('图片')).toBeTruthy() })
    expect(view.getByRole('button', { name: '图片，点击查看原图' })).toBeTruthy()
  })

  it('surfaces a retry control when durable bytes cannot be read, including a failed retry', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('still offline'))
      .mockResolvedValueOnce('blob:retry')
    const view = render(<MessageImage image={{ attachment }} load={load} variant="single" labels={labels} />)
    const retry = await view.findByRole('button', { name: '图片加载失败，点击重试' })
    fireEvent.click(retry)
    const retryAgain = await view.findByRole('button', { name: '图片加载失败，点击重试' })
    fireEvent.click(retryAgain)
    await waitFor(() => { expect(view.getByAltText('history.png')).toBeTruthy() })
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('clamps extreme aspect ratios and anchors the crop toward the informative edge', async () => {
    const load = vi.fn().mockResolvedValue('blob:ratio')
    const tall = render(
      <MessageImage image={{ attachment: { ...attachment, width: 100, height: 2000 } }} load={load} variant="single" labels={labels} />,
    )
    const tallFrame = tall.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(tallFrame.getAttribute('style')).toContain('width: 60px')
    expect(tallFrame.getAttribute('style')).toContain('height: 240px')
    await waitFor(() => { expect(tall.getByAltText('history.png')).toBeTruthy() })
    expect(tall.getByAltText('history.png').style.objectPosition).toBe('center top')
    tall.unmount()
    const wide = render(
      <MessageImage image={{ attachment: { ...attachment, width: 4000, height: 100 } }} load={load} variant="single" labels={labels} />,
    )
    const wideFrame = wide.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(wideFrame.getAttribute('style')).toContain('width: 240px')
    expect(wideFrame.getAttribute('style')).toContain('height: 60px')
    await waitFor(() => { expect(wide.getByAltText('history.png')).toBeTruthy() })
    expect(wide.getByAltText('history.png').style.objectPosition).toBe('left center')
    wide.unmount()
    const small = render(
      <MessageImage image={{ attachment: { ...attachment, width: 100, height: 100 } }} load={load} variant="single" labels={labels} />,
    )
    const smallFrame = small.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(smallFrame.getAttribute('style')).toContain('width: 100px')
    expect(smallFrame.getAttribute('style')).toContain('height: 100px')
  })

  it('grows a downscaled attachment up to the preview box once the bitmap loads', async () => {
    const load = vi.fn().mockResolvedValue('blob:full')
    const view = render(
      <MessageImage image={{ attachment: { ...attachment, width: 10, height: 10 } }} load={load} variant="single" labels={labels} />,
    )
    const frame = view.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(frame.getAttribute('style')).toContain('width: 10px')
    const img = await view.findByAltText('history.png')
    Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 400, configurable: true })
    fireEvent.load(img)
    await waitFor(() => {
      expect(frame.getAttribute('style')).toContain('width: 240px')
    })
    fireEvent.click(frame)
    expect(view.getByRole('dialog', { name: '原图预览' })).toBeTruthy()
  })

  it('does not reload when the owner rebuilds its loader identity', async () => {
    const first = vi.fn().mockResolvedValue('blob:first')
    const view = render(<MessageImage image={{ attachment }} load={first} variant="single" labels={labels} />)
    await waitFor(() => { expect(view.getByAltText('history.png')).toBeTruthy() })
    const second = vi.fn().mockResolvedValue('blob:second')
    view.rerender(<MessageImage image={{ attachment }} load={second} variant="single" labels={labels} />)
    // The chat node rebuilds its loader every paint; that is not a load trigger.
    expect(second).not.toHaveBeenCalled()
    expect(view.getByAltText('history.png').getAttribute('src')).toBe('blob:first')
  })

  it('paints a cached URL on the first frame through the loader peek', () => {
    const load = Object.assign(vi.fn(() => new Promise<string>(() => {})), { peek: () => 'blob:cached' })
    const view = render(<MessageImage image={{ attachment }} load={load} variant="single" labels={labels} />)
    expect(view.getByAltText('history.png').getAttribute('src')).toBe('blob:cached')
    expect(view.queryByText('图片加载中…')).toBeNull()
  })

  it('pins a dimension-less preview to the bounded fallback box and promotes on load', async () => {
    // The submission echo's first frame carries no intrinsic size; without a
    // fixed box the raster would render at its natural resolution. The frame
    // must stay pinned at the 240px square until onLoad exposes the size.
    const view = render(
      <MessageImage image={{ preview: { url: 'blob:echo', name: 'echo.png' } }} load={vi.fn()} variant="single" labels={labels} />,
    )
    const frame = view.getByRole('button', { name: 'echo.png，点击查看原图' })
    expect(frame.getAttribute('style')).toContain('width: 240px')
    expect(frame.getAttribute('style')).toContain('height: 240px')
    const fallback = view.getByAltText('echo.png') as HTMLImageElement
    expect(fallback.className).toContain('previewFallback')
    // jsdom exposes naturalWidth/Height as read-only zero getters; define
    // them before dispatching load so the onLoad promotion sees real values.
    Object.defineProperty(fallback, 'naturalWidth', { value: 640, configurable: true })
    Object.defineProperty(fallback, 'naturalHeight', { value: 320, configurable: true })
    fireEvent.load(fallback)
    await waitFor(() => {
      expect(frame.getAttribute('style')).toContain('width: 240px')
      expect(frame.getAttribute('style')).toContain('height: 120px')
    })
    // After promotion the ordinary cover-fit image renders, not the fallback.
    expect(view.getByAltText('echo.png').className).not.toContain('previewFallback')
  })

  it('renders a tile at the fixed square without inline sizing', () => {
    const load = vi.fn(() => new Promise<string>(() => {}))
    const view = render(<MessageImage image={{ attachment }} load={load} variant="tile" labels={labels} />)
    const frame = view.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(frame.getAttribute('data-variant')).toBe('tile')
    expect(frame.getAttribute('style')).toBeNull()
  })

  it('keeps the tile variant on the failed-load retry control', async () => {
    const load = vi.fn().mockRejectedValue(new Error('offline'))
    const view = render(<MessageImage image={{ attachment }} load={load} variant="tile" labels={labels} />)
    const retry = await view.findByRole('button', { name: '图片加载失败，点击重试' })
    expect(retry.getAttribute('data-variant')).toBe('tile')
  })

  it('ignores a load settling after unmount', async () => {
    let resolve: ((url: string) => void) | undefined
    const load = vi.fn(() => new Promise<string>((r) => { resolve = r }))
    const view = render(<MessageImage image={{ attachment }} load={load} variant="single" labels={labels} />)
    view.unmount()
    resolve?.('blob:late')
    await Promise.resolve()
    let reject: ((error: Error) => void) | undefined
    const failing = vi.fn(() => new Promise<string>((_r, rej) => { reject = rej }))
    const second = render(<MessageImage image={{ attachment }} load={failing} variant="single" labels={labels} />)
    second.unmount()
    reject?.(new Error('late failure'))
    await Promise.resolve()
  })
})

/** Minimal IntersectionObserver double: the lane has no layout, so the test
 * fires the intersection itself and proves the gate is what defers the load. */
class FakeIntersectionObserver {
  static readonly built: FakeIntersectionObserver[] = []
  readonly targets = new Set<Element>()
  constructor(readonly callback: IntersectionObserverCallback) { FakeIntersectionObserver.built.push(this) }
  observe(target: Element): void { this.targets.add(target) }
  unobserve(target: Element): void { this.targets.delete(target) }
  disconnect(): void { this.targets.clear() }
  takeRecords(): IntersectionObserverEntry[] { return [] }
  fire(): boolean {
    const target = [...this.targets][0]
    if (target === undefined) return false
    this.callback([{ isIntersecting: true, target } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver)
    return true
  }
}

describe('MessageImage viewport gate', () => {
  afterEach(() => { FakeIntersectionObserver.built.length = 0 })

  it('issues no attachment request until the frame reaches the viewport', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    try {
      const load = vi.fn().mockResolvedValue('blob:late-image')
      const view = render(<MessageImage image={{ attachment }} load={load} variant="single" labels={labels} />)
      const frame = view.getByRole('button', { name: 'history.png，点击查看原图' })
      // The frame keeps its exact single-image geometry while it waits, so a
      // long scrollback never jumps when the pictures arrive.
      expect(frame.getAttribute('style')).toContain('width: 240px')
      expect(frame.getAttribute('style')).toContain('height: 120px')
      expect(view.getByText('图片加载中…')).toBeTruthy()
      expect(load).not.toHaveBeenCalled()
      expect(view.queryByAltText('history.png')).toBeNull()
      const observer = FakeIntersectionObserver.built.at(-1)
      expect(observer).toBeDefined()
      await act(async () => { observer?.fire() })
      await waitFor(() => { expect(view.getByAltText('history.png')).toBeTruthy() })
      expect(load).toHaveBeenCalledWith(attachment)
      // First intersection is permanent: the frame leaves the observer.
      expect(observer?.targets.size).toBe(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('MessageImage downscaling', () => {
  const originals = {
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
    getContext: HTMLCanvasElement.prototype.getContext,
    toBlob: HTMLCanvasElement.prototype.toBlob,
  }
  afterEach(() => {
    Object.assign(URL, { createObjectURL: originals.create, revokeObjectURL: originals.revoke })
    HTMLCanvasElement.prototype.getContext = originals.getContext
    HTMLCanvasElement.prototype.toBlob = originals.toBlob
    vi.unstubAllGlobals()
  })

  it('paints the shrunk bitmap and revokes its object URL on unmount', async () => {
    const close = vi.fn()
    const bitmap = { width: 4000, height: 2000, close }
    const createImageBitmap = vi.fn(async () => bitmap)
    vi.stubGlobal('createImageBitmap', createImageBitmap)
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => blob }) as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const createObjectURL = vi.fn(() => 'blob:shrunk')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const drawImage = vi.fn()
    const context = { drawImage, imageSmoothingEnabled: false, imageSmoothingQuality: 'low' }
    HTMLCanvasElement.prototype.getContext = vi.fn(() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.toBlob = ((callback: BlobCallback) => {
      callback(new Blob([new Uint8Array([9])], { type: 'image/webp' }))
    }) as typeof HTMLCanvasElement.prototype.toBlob
    const load = vi.fn().mockResolvedValue('blob:original')
    const view = render(<MessageImage image={{ attachment }} load={load} variant="single" labels={labels} />)
    await waitFor(() => { expect(view.getByAltText('history.png').getAttribute('src')).toBe('blob:shrunk') })
    expect(fetchMock).toHaveBeenCalledWith('blob:original')
    expect(createImageBitmap).toHaveBeenCalledWith(blob)
    // 4000×2000 capped to a 480px long edge, drawn in one filtered pass.
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 480, 240)
    expect(context.imageSmoothingQuality).toBe('high')
    // The full-resolution raster is released as soon as the copy exists.
    expect(close).toHaveBeenCalled()
    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:shrunk')
  })

  it('leaves a raster that already fits alone instead of upscaling it', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 100, height: 60, close })))
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }),
    }) as unknown as Response))
    const createObjectURL = vi.fn(() => 'blob:upscaled')
    Object.assign(URL, { createObjectURL })
    const load = vi.fn().mockResolvedValue('blob:original')
    const view = render(<MessageImage image={{ attachment }} load={load} variant="single" labels={labels} />)
    await waitFor(() => { expect(view.getByAltText('history.png').getAttribute('src')).toBe('blob:original') })
    // A 100px icon must keep its own naturalWidth: the frame's promotion
    // would otherwise grow it to 240px of blur.
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
  })

  it('keeps the original URL when the engine cannot shrink it', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('no options support') }))
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }),
    }) as unknown as Response))
    const load = vi.fn().mockResolvedValue('blob:original')
    const view = render(<MessageImage image={{ attachment }} load={load} variant="single" labels={labels} />)
    await waitFor(() => { expect(view.getByAltText('history.png').getAttribute('src')).toBe('blob:original') })
    // A blank thumbnail is never the failure mode.
    expect(view.queryByText('图片加载失败，点击重试')).toBeNull()
  })
})

describe('ImageGallery', () => {
  it('renders nothing without images and an aligned wrapping group with them', async () => {
    const load = vi.fn().mockResolvedValue('blob:gallery')
    const empty = render(<ImageGallery images={[]} load={load} align="start" labels={labels} />)
    expect(empty.container.firstChild).toBeNull()
    const view = render(
      <ImageGallery images={[{ attachment }, { attachment }]} load={load} align="end" labels={labels} />,
    )
    expect(view.container.querySelector('[data-align="end"]')).not.toBeNull()
    await waitFor(() => { expect(view.getAllByAltText('history.png')).toHaveLength(2) })
  })

  it('mounts only the first dozen tiles and expands the rest on demand', () => {
    const load = vi.fn(() => new Promise<string>(() => {}))
    const many = Array.from({ length: 20 }, () => ({ attachment }))
    const view = render(<ImageGallery images={many} load={load} align="start" labels={labels} />)
    expect(view.container.querySelectorAll('[data-variant="tile"]')).toHaveLength(12)
    // Twenty mounted frames would be twenty decoders; one cell holds the rest.
    const more = view.getByRole('button', { name: '+8' })
    fireEvent.click(more)
    expect(view.container.querySelectorAll('[data-variant="tile"]')).toHaveLength(20)
    expect(view.queryByRole('button', { name: '+8' })).toBeNull()
  })

  it('renders a lone image large and several images as square tiles', () => {
    const load = vi.fn(() => new Promise<string>(() => {}))
    const lone = render(<ImageGallery images={[{ attachment }]} load={load} align="start" labels={labels} />)
    expect(lone.container.querySelectorAll('[data-variant="single"]')).toHaveLength(1)
    lone.unmount()
    const several = render(
      <ImageGallery images={[{ attachment }, { attachment }, { attachment }]} load={load} align="end" labels={labels} />,
    )
    expect(several.container.querySelectorAll('[data-variant="tile"]')).toHaveLength(3)
  })

  it('raises the lone preview to the expanded Tool-card box when the owner asks', () => {
    const load = vi.fn(() => new Promise<string>(() => {}))
    const view = render(
      <ImageGallery images={[{ attachment }]} load={load} align="start" maxEdge={520} labels={labels} />,
    )
    const frame = view.getByRole('button', { name: 'history.png，点击查看原图' })
    expect(frame.getAttribute('style')).toContain('width: 520px')
    expect(frame.getAttribute('style')).toContain('height: 260px')
    view.unmount()
    // The message rule stays untouched for the same attachment.
    const message = render(<ImageGallery images={[{ attachment }]} load={load} align="start" labels={labels} />)
    expect(message.getByRole('button', { name: 'history.png，点击查看原图' }).getAttribute('style'))
      .toContain('width: 240px')
  })

  it('keeps several tool images in an inspect-sized tile grid', () => {
    const load = vi.fn(() => new Promise<string>(() => {}))
    const view = render(
      <ImageGallery
        images={[{ attachment }, { attachment }]}
        load={load}
        align="start"
        maxEdge={520}
        labels={labels}
      />,
    )
    expect(view.container.querySelectorAll('[data-variant="tile"][data-large]')).toHaveLength(2)
    // Without the tool size, tiles stay the 64px history grid.
    const history = render(
      <ImageGallery images={[{ attachment }, { attachment }]} load={load} align="start" labels={labels} />,
    )
    expect(history.container.querySelectorAll('[data-variant="tile"][data-large]')).toHaveLength(0)
  })

  it('renders the conversation slot entry with translated labels', async () => {
    const t = ((key: string, params?: Readonly<Record<string, unknown>>) => {
      const translated: Record<string, string> = {
        'image.label': '图片',
        'image.openOriginal': '查看原图',
        'image.loading': '图片加载中…',
        'image.loadFailed': '图片加载失败，点击重试',
        'image.preview': '原图预览',
        'image.closePreview': '关闭原图预览',
      }
      if (key === 'image.openOriginalLabel') {
        const label = params?.label
        return `${typeof label === 'string' ? label : ''}，点击查看原图`
      }
      return translated[key] ?? key
    }) as MessageImagesProps['t']
    const loadImage = vi.fn().mockResolvedValue('blob:slot-image')
    const useSession: MessageImagesProps['useSession'] = () => {
      throw new Error('MessageImages does not read the session snapshot')
    }
    const useInput: MessageImagesProps['useInput'] = () => {
      throw new Error('MessageImages does not read the input snapshot')
    }
    const useSessions: MessageImagesProps['useSessions'] = () => {
      throw new Error('MessageImages does not read the session list snapshot')
    }
    const useWorkspaces: MessageImagesProps['useWorkspaces'] = () => {
      throw new Error('MessageImages does not read the workspace list snapshot')
    }
    const props: MessageImagesProps = {
      sessionId: 'message-images-test' as MessageImagesProps['sessionId'],
      useSession,
      useSessions,
      useWorkspaces,
      useProjection: () => undefined,
      useInput,
      inputActions: {
        setDraft: vi.fn(),
        addImages: vi.fn(() => true),
        removeImage: vi.fn(),
        pruneImages: vi.fn(),
        submit: vi.fn(),
      },
      images: [{ attachment }],
      loadImage,
      align: 'end',
      maxEdge: 520,
      t,
    }
    const view = render(<MessageImages {...props} />)
    await waitFor(() => { expect(view.getByAltText('history.png')).toBeTruthy() })
    // The tool-call owner's inspect size reaches the gallery through the slot.
    expect(view.getByRole('button', { name: 'history.png，点击查看原图' }).getAttribute('style'))
      .toContain('width: 520px')
    expect(view.container.querySelector('[data-align="end"]')).not.toBeNull()
  })
})
