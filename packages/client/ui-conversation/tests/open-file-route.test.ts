/** Unit tests for chat → workbench / workspaces open routing. */
import { describe, expect, it, vi } from 'vitest'
import { routeChatOpenFile } from '../src/client/open-file-route.ts'

describe('routeChatOpenFile', () => {
  it('stops at workbench when openPath returns true', async () => {
    const openWorkspace = vi.fn(async () => {})
    await routeChatOpenFile('/a.ts', { openPath: () => true }, openWorkspace)
    expect(openWorkspace).not.toHaveBeenCalled()
  })

  it('falls through to workspaces.openPath when workbench refuses', async () => {
    const openWorkspace = vi.fn(async () => {})
    await routeChatOpenFile('/a.ts', { openPath: () => false }, openWorkspace)
    expect(openWorkspace).toHaveBeenCalledWith('/a.ts')
  })

  it('falls through when workbench is absent', async () => {
    const openWorkspace = vi.fn(async () => {})
    await routeChatOpenFile('/a.ts', undefined, openWorkspace)
    expect(openWorkspace).toHaveBeenCalledWith('/a.ts')
  })
})
