import { describe, expect, it, vi } from 'vitest'
import {
  GIT_WORKTREES_ENTRY_ID,
  GitWorktreesCardController,
} from '../src/client/git-worktrees-card-controller.ts'

describe('GitWorktreesCardController', () => {
  it('injects hooks.gitWorktreesCard (not a raw useSnapshot)', async () => {
    const list = vi.fn(async () => ({
      ok: true as const,
      value: {
        entries: [{ entryId: GIT_WORKTREES_ENTRY_ID, enabled: false }],
      },
    }))
    const setEnabled = vi.fn(async () => ({ ok: true as const }))
    const ctrl = new GitWorktreesCardController({ list, setEnabled })
    const face = ctrl.inject()
    expect(face.hooks.gitWorktreesCard).toBeDefined()
    expect(typeof face.hooks.gitWorktreesCard.getSnapshot).toBe('function')
    expect(typeof face.hooks.gitWorktreesCard.subscribe).toBe('function')
    expect(typeof face.setEnabled).toBe('function')
    await vi.waitFor(() => {
      expect(face.hooks.gitWorktreesCard.getSnapshot().available).toBe(true)
    })
    expect(face.hooks.gitWorktreesCard.getSnapshot().enabled).toBe(false)
    ctrl.dispose()
  })

  it('stays available when inventory omits the row (Plugins config card)', async () => {
    const list = vi.fn(async () => ({
      ok: true as const,
      value: { entries: [] },
    }))
    const setEnabled = vi.fn(async () => ({ ok: true as const }))
    const ctrl = new GitWorktreesCardController({ list, setEnabled })
    const face = ctrl.inject()
    expect(face.hooks.gitWorktreesCard.getSnapshot().available).toBe(true)
    await vi.waitFor(() => {
      expect(face.hooks.gitWorktreesCard.getSnapshot().failed).toBe(true)
    })
    expect(face.hooks.gitWorktreesCard.getSnapshot().available).toBe(true)
    ctrl.dispose()
  })
})
