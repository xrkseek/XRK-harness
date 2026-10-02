import { describe, expect, it, vi } from 'vitest'
import { routeChatOpenFile } from '../src/client/open-file-route.ts'

describe('routeChatOpenFile', () => {
  it('wakes community sidebar with an editor tab before openPath', async () => {
    const openWorkspace = vi.fn(async () => {})
    const openTab = vi.fn()
    await routeChatOpenFile('/w/a.ts', openWorkspace, (p) => {
      // Same seed shape as chat / Overview openFile (side workbench, not bottom).
      openTab({ type: 'editor', path: p })
    })
    expect(openTab).toHaveBeenCalledTimes(1)
    expect(openTab).toHaveBeenCalledWith({ type: 'editor', path: '/w/a.ts' })
    expect(openWorkspace).toHaveBeenCalledTimes(1)
    expect(openWorkspace).toHaveBeenCalledWith('/w/a.ts')
  })

  it('skips attachment addresses', async () => {
    const openWorkspace = vi.fn(async () => {})
    const wake = vi.fn()
    await routeChatOpenFile('attachment:abc', openWorkspace, wake)
    expect(wake).not.toHaveBeenCalled()
    expect(openWorkspace).not.toHaveBeenCalled()
  })
})
