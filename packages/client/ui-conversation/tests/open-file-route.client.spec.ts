/** Unit tests for chat → community / workspaces open routing. */
import { describe, expect, it, vi } from 'vitest'
import { routeChatOpenFile } from '../src/client/open-file-route.ts'

describe('routeChatOpenFile', () => {
  it('opens via workspaces.openPath', async () => {
    const openWorkspace = vi.fn(async () => {})
    await routeChatOpenFile('/a.ts', openWorkspace)
    expect(openWorkspace).toHaveBeenCalledWith('/a.ts')
  })

  it('wakes community before workspaces', async () => {
    const openWorkspace = vi.fn(async () => {})
    const wake = vi.fn()
    await routeChatOpenFile('/a.ts', openWorkspace, wake)
    expect(wake).toHaveBeenCalledWith('/a.ts')
    expect(openWorkspace).toHaveBeenCalledWith('/a.ts')
  })

  it('skips community and workspaces for attachment ids', async () => {
    const openWorkspace = vi.fn(async () => {})
    const wake = vi.fn()
    await routeChatOpenFile(
      'sha256:614b7f3194c587139769f70801d2cb8578192c1a3dc704c244f82013c379ac16',
      openWorkspace,
      wake,
    )
    expect(wake).not.toHaveBeenCalled()
    expect(openWorkspace).not.toHaveBeenCalled()
  })
})
