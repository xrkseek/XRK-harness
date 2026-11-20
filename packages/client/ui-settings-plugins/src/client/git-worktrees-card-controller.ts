/**
 * Plugins-home card for the optional `git-worktrees` product bundle.
 * Enable path = Face pluginInventory.setEnabled → Host syncManagedProcessPlugins
 * → create_worktree tools when the soft-disable marker is cleared.
 */
import { createSnapshotStore, type SnapshotStore } from '@xrkseek/client-runtime/client'
import type { PluginEntryId } from '@xrkseek/xrk-api-remotes/client'

export const GIT_WORKTREES_ENTRY_ID = 'git-worktrees' as PluginEntryId

export type GitWorktreesCardState = {
  readonly available: boolean
  readonly enabled: boolean
  readonly busy: boolean
  readonly failed: boolean
}

export type GitWorktreesCardFace = {
  readonly useGitWorktreesCard: SnapshotStore<GitWorktreesCardState>['useSnapshot']
  readonly setEnabled: (enabled: boolean) => void
  readonly refresh: () => void
}

type InventoryRemote = {
  readonly list: () => Promise<{
    readonly ok: boolean
    readonly value?: { readonly entries?: readonly { readonly entryId: string; readonly enabled: boolean }[] }
  }>
  readonly setEnabled: (
    entryId: PluginEntryId,
    enabled: boolean,
  ) => Promise<{ readonly ok: boolean }>
}

export class GitWorktreesCardController {
  private readonly store: SnapshotStore<GitWorktreesCardState>
  private enabled = false
  private available = false
  private busy = false
  private failed = false
  private disposed = false

  constructor(private readonly inventory: InventoryRemote) {
    this.store = createSnapshotStore(this.projection())
    void this.refresh()
  }

  get face(): GitWorktreesCardFace {
    return {
      useGitWorktreesCard: this.store.useSnapshot,
      setEnabled: (enabled) => { void this.apply(enabled) },
      refresh: () => { void this.refresh() },
    }
  }

  dispose(): void {
    this.disposed = true
  }

  private projection(): GitWorktreesCardState {
    return {
      available: this.available,
      enabled: this.enabled,
      busy: this.busy,
      failed: this.failed,
    }
  }

  private publish(): void {
    this.store.setSnapshot(this.projection())
  }

  async refresh(): Promise<void> {
    try {
      const result = await this.inventory.list()
      if (this.disposed) return
      if (!result.ok || !Array.isArray(result.value?.entries)) {
        this.available = false
        this.publish()
        return
      }
      const row = result.value.entries.find((e) => e.entryId === GIT_WORKTREES_ENTRY_ID)
      this.available = row !== undefined
      this.enabled = row?.enabled === true
      this.failed = false
      this.publish()
    } catch {
      if (this.disposed) return
      this.available = false
      this.publish()
    }
  }

  private async apply(enabled: boolean): Promise<void> {
    if (this.busy || !this.available) return
    this.busy = true
    this.failed = false
    this.enabled = enabled
    this.publish()
    try {
      const result = await this.inventory.setEnabled(GIT_WORKTREES_ENTRY_ID, enabled)
      if (this.disposed) return
      this.failed = !result.ok
      if (!result.ok) this.enabled = !enabled
    } catch {
      if (this.disposed) return
      this.failed = true
      this.enabled = !enabled
    }
    this.busy = false
    this.publish()
    void this.refresh()
  }
}
