import { describe, expect, it, vi } from 'vitest'
import { routeChatOpenFile } from '../src/client/open-file-route.ts'

describe('routeChatOpenFile', () => {
  it('wakes community sidebar with an editor tab before openPath', async () => {
    const openWorkspace = vi.fn(async () => {})
    const openTab = vi.fn()
    await routeChatOpenFile('/w/a.ts', openWorkspace, (p) => {
      // Same seed shape as chat / Overview openFile (side workbench, not bottom).
      openTab({ type: 'editor', path: p })
      return true
    })
    expect(openTab).toHaveBeenCalledTimes(1)
    expect(openTab).toHaveBeenCalledWith({ type: 'editor', path: '/w/a.ts' })
    expect(openWorkspace).toHaveBeenCalledTimes(1)
    expect(openWorkspace).toHaveBeenCalledWith('/w/a.ts')
  })

  it('skips OS open when allowNativeOpen is false (SSH / WAN Web)', async () => {
    const openWorkspace = vi.fn(async () => {})
    const openTab = vi.fn()
    await routeChatOpenFile(
      '/w/a.ts',
      openWorkspace,
      (p) => {
        openTab({ type: 'editor', path: p })
        return true
      },
      { allowNativeOpen: false },
    )
    expect(openTab).toHaveBeenCalledTimes(1)
    expect(openWorkspace).not.toHaveBeenCalled()
  })

  it('downloads on remote/WAN when community wake fails', async () => {
    const openWorkspace = vi.fn(async () => {})
    const download = vi.fn()
    await routeChatOpenFile(
      '/w/deck.pptx',
      openWorkspace,
      () => false,
      { allowNativeOpen: false, downloadFile: download },
    )
    expect(openWorkspace).not.toHaveBeenCalled()
    expect(download).toHaveBeenCalledWith('/w/deck.pptx')
  })

  it('rejects when remote/WAN has neither workbench nor download', async () => {
    const openWorkspace = vi.fn(async () => {})
    await expect(routeChatOpenFile(
      '/w/deck.pptx',
      openWorkspace,
      () => false,
      { allowNativeOpen: false },
    )).rejects.toMatchObject({ code: 'native-open-unavailable', path: '/w/deck.pptx' })
    expect(openWorkspace).not.toHaveBeenCalled()
  })

  it('still OS-opens on privileged loopback when allowNativeOpen is omitted', async () => {
    const openWorkspace = vi.fn(async () => {})
    await routeChatOpenFile('/w/deck.pptx', openWorkspace, () => false)
    expect(openWorkspace).toHaveBeenCalledWith('/w/deck.pptx')
  })

  it('soft-fails OS open after a successful community wake', async () => {
    const openWorkspace = vi.fn(async () => {
      throw new Error('xdg-open is not available')
    })
    const openTab = vi.fn()
    await expect(routeChatOpenFile('/w/a.ts', openWorkspace, (p) => {
      openTab({ type: 'editor', path: p })
      return true
    })).resolves.toBeUndefined()
    expect(openTab).toHaveBeenCalledTimes(1)
    expect(openWorkspace).toHaveBeenCalledTimes(1)
  })

  it('downloads when privileged OS open fails and no workbench woke', async () => {
    const openWorkspace = vi.fn(async () => {
      throw new Error('xdg-open is not available')
    })
    const download = vi.fn()
    await routeChatOpenFile('/w/deck.pptx', openWorkspace, () => false, {
      downloadFile: download,
    })
    expect(download).toHaveBeenCalledWith('/w/deck.pptx')
  })

  it('rethrows OS open errors when neither workbench nor download is available', async () => {
    const openWorkspace = vi.fn(async () => {
      throw new Error('xdg-open is not available')
    })
    await expect(routeChatOpenFile('/w/a.ts', openWorkspace, () => false))
      .rejects.toThrow('xdg-open is not available')
  })

  it('skips attachment addresses', async () => {
    const openWorkspace = vi.fn(async () => {})
    const wake = vi.fn()
    await routeChatOpenFile('attachment:abc', openWorkspace, wake)
    expect(wake).not.toHaveBeenCalled()
    expect(openWorkspace).not.toHaveBeenCalled()
  })
})
