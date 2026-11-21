/**
 * Plugins-home card for the optional `git-worktrees` product bundle.
 * Enable path = Face pluginInventory.setEnabled → Host syncManagedProcessPlugins
 * → create_worktree tools when the soft-disable marker is cleared.
 *
 * Inject face uses the standard `hooks` seat so web-react synthesizes
 * `useGitWorktreesCard` (SnapshotStore has no selector hook of its own).
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
  hooks: {
    gitWorktreesCard: SnapshotStore<GitWorktreesCardState>
  }
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
    // Show immediately; refresh fills enabled from inventory.
    this.available = true
    this.store = createSnapshotStore(this.projection())
    void this.refresh()
  }

  inject(): GitWorktreesCardFace {
    return {
      hooks: { gitWorktreesCard: this.store },
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
    this.store.set(this.projection())
  }

  async refresh(): Promise<void> {
    try {
      const result = await this.inventory.list()
      if (this.disposed) return
      if (!result.ok || !Array.isArray(result.value?.entries)) {
        // Keep the card mounted; switch stays non-writable until list works.
        this.available = false
        this.failed = true
        this.publish()
        return
      }
      const row = result.value.entries.find((e) => e.entryId === GIT_WORKTREES_ENTRY_ID)
      // Product optional: card stays available even if the row is briefly absent.
      this.available = true
      this.enabled = row?.enabled === true
      this.failed = row === undefined
      this.publish()
    } catch {
      if (this.disposed) return
      this.available = false
      this.failed = true
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
