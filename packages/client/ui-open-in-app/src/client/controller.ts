/** Browser availability/choice state and Face launch carrier for Open In. */

import {
  createSnapshotStore, type SnapshotStore,
} from '@xrkseek/client-runtime/client'
import type { ConnectionHandle } from '@xrkseek/client-connection/client'

/**
 * Owns the once-per-page availability read, the persisted last choice, and
 * Face `host.openInApp` launches. Every Session header shares one truth.
 */
export class OpenInAppController {
  /** Installed app ids in Host menu order; null until Face answered. */
  readonly apps: SnapshotStore<readonly string[] | null> = createSnapshotStore<readonly string[] | null>(null)
  /** Last chosen app id (browser-persisted). */
  readonly choice: SnapshotStore<string> = createSnapshotStore<string>('', {
    persist: { name: 'xrk.open-in-app.choice' },
  })

  private loading: Promise<void> | undefined

  /**
   * @param connection - Face API carrier.
   */
  constructor(private readonly connection: ConnectionHandle) {}

  /** Read availability once per controller life. */
  load(): Promise<void> {
    this.loading ??= this.run()
    return this.loading
  }

  /** Remember one picked app id. */
  choose(appId: string): void {
    this.choice.set(appId)
  }

  /**
   * Launch one installed app on a workspace directory via Face.
   * @param appId - catalog id from the availability list.
   * @param path - absolute session workspace directory.
   */
  async launch(appId: string, path: string): Promise<void> {
    const response = await this.connection.api.host.openInApp({ app: appId, path })
    if (!response.result.ok) {
      throw new Error(response.result.error.message)
    }
  }

  private async run(): Promise<void> {
    let apps: readonly string[] = []
    try {
      const response = await this.connection.api.host.listOpenInApps({})
      if (response.result.ok && Array.isArray(response.result.value.apps)) {
        apps = response.result.value.apps.filter(id => typeof id === 'string')
      }
    } catch {
      // Unreachable Host → no button.
    }
    this.apps.set(apps)
  }
}
