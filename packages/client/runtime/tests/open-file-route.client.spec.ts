import { describe, expect, it, vi } from 'vitest'
import {
  NativeOpenUnavailableError,
  routeWorkspaceOpenFile,
} from '../src/client/workspaces/open-file-route.ts'
import {
  basenameForDownload,
  bytesToBase64,
  isObjectDownloadUrl,
  looksLikeDirectoryPath,
  triggerBrowserOrShellDownload,
  workspaceFileDownloadUrl,
} from '../src/client/workspaces/file-download.ts'

describe('routeWorkspaceOpenFile surfaces', () => {
  it('opens on privileged loopback (Desktop / LAN / phone local Host)', async () => {
    const open = vi.fn(async () => {})
    await routeWorkspaceOpenFile('/w/deck.pptx', open)
    expect(open).toHaveBeenCalledWith('/w/deck.pptx')
  })

  it('wakes workbench and skips OS open on public / remote surfaces', async () => {
    const open = vi.fn(async () => {})
    const wake = vi.fn(() => true)
    const download = vi.fn()
    await routeWorkspaceOpenFile('/w/a.ts', open, wake, {
      allowNativeOpen: false,
      downloadFile: download,
    })
    expect(wake).toHaveBeenCalledWith('/w/a.ts')
    expect(open).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })

  it('downloads on public phone/WAN when workbench is absent', async () => {
    const open = vi.fn(async () => {})
    const download = vi.fn()
    await routeWorkspaceOpenFile('/w/deck.pptx', open, () => false, {
      allowNativeOpen: false,
      downloadFile: download,
    })
    expect(open).not.toHaveBeenCalled()
    expect(download).toHaveBeenCalledWith('/w/deck.pptx')
  })

  it('throws NativeOpenUnavailableError for remote directories (not downloadable)', async () => {
    const download = vi.fn()
    await expect(
      routeWorkspaceOpenFile('.', vi.fn(async () => {}), () => false, {
        allowNativeOpen: false,
        downloadFile: download,
      }),
    ).rejects.toBeInstanceOf(NativeOpenUnavailableError)
    expect(download).not.toHaveBeenCalled()
  })

  it('falls back to download when privileged OS open fails', async () => {
    const open = vi.fn(async () => {
      throw new Error('xdg-open is not available')
    })
    const download = vi.fn()
    await routeWorkspaceOpenFile('/w/deck.pptx', open, () => false, {
      downloadFile: download,
    })
    expect(download).toHaveBeenCalledWith('/w/deck.pptx')
  })

  it('soft-fails OS open after workbench wake (guest container / missing xdg-open)', async () => {
    const open = vi.fn(async () => {
      throw new Error('xdg-open is not available')
    })
    const download = vi.fn()
    await expect(
      routeWorkspaceOpenFile('/w/a.ts', open, () => true, { downloadFile: download }),
    ).resolves.toBeUndefined()
    expect(download).not.toHaveBeenCalled()
  })
})

describe('workspace file download URL', () => {
  it('builds /sidebar/file?download=1 with session and path', () => {
    const url = workspaceFileDownloadUrl('/proj/deck.pptx', { sessionId: 's1', cwd: '/proj' })
    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/sidebar/file')
    expect(parsed.searchParams.get('download')).toBe('1')
    expect(parsed.searchParams.get('path')).toBe('/proj/deck.pptx')
    expect(parsed.searchParams.get('sessionId')).toBe('s1')
    expect(parsed.searchParams.get('cwd')).toBe('/proj')
  })

  it('names downloads from the path basename', () => {
    expect(basenameForDownload('/a/b/deck.pptx')).toBe('deck.pptx')
    expect(looksLikeDirectoryPath('.')).toBe(true)
    expect(looksLikeDirectoryPath('/a/b/')).toBe(true)
    expect(looksLikeDirectoryPath('/a/b/deck.pptx')).toBe(false)
  })

  it('detects blob/data object URLs the phone shell cannot HTTP-GET', () => {
    expect(isObjectDownloadUrl('blob:http://127.0.0.1:8787/abc')).toBe(true)
    expect(isObjectDownloadUrl('data:text/plain;base64,YQ==')).toBe(true)
    expect(isObjectDownloadUrl('http://127.0.0.1:8787/api/session.export')).toBe(false)
  })

  it('encodes bytes as base64 in chunks', () => {
    expect(bytesToBase64(new Uint8Array([97, 98, 99]))).toBe('YWJj')
  })

  it('posts downloadBytes to XrkShell for blob URLs instead of a fake HTTP GET', async () => {
    const posts: string[] = []
    ;(globalThis as { XrkShell?: { postMessage: (raw: string) => void } }).XrkShell = {
      postMessage: (raw) => { posts.push(raw) },
    }
    const blobUrl = 'blob:http://127.0.0.1:8787/unit-test'
    const bytes = new TextEncoder().encode('# hello')
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      blob: async () => ({
        type: 'text/markdown',
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      }),
    }))
    const prevFetch = globalThis.fetch
    globalThis.fetch = fetchImpl as unknown as typeof fetch
    try {
      triggerBrowserOrShellDownload(blobUrl, 'note.md')
      await vi.waitFor(() => expect(posts.length).toBe(1))
      const payload = JSON.parse(posts[0]!) as { op: string; filename: string; mime: string; base64: string; message?: string }
      expect(payload, JSON.stringify(payload)).toMatchObject({
        op: 'downloadBytes',
        filename: 'note.md',
        mime: 'text/markdown',
        base64: bytesToBase64(bytes),
      })
      expect(fetchImpl).toHaveBeenCalledWith(blobUrl)
    } finally {
      globalThis.fetch = prevFetch
      delete (globalThis as { XrkShell?: unknown }).XrkShell
    }
  })
})
