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

  it('rethrows OS open errors when community did not wake', async () => {
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
