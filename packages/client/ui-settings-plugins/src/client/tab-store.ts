/**
 * The configurable-plugins tab's card list.
 *
 * The tab dispatches its slot by settings namespace. First-party cards are the
 * intersection of Face `settings.describe` namespaces and registered
 * `settings.plugin.item` keys. Community cards (e.g. `@liustack/modlens`)
 * register keys Face never advertises — they self-host config over dsh-compat
 * HTTP — so any registered key that is not a Face-served first-party namespace
 * is still dispatched when its card is present.
 */

import type { IApiClient } from '@xrkseek/client-connection/client'
import type { StoredEntry } from '@xrkseek/client-ui-slots'
import { createSnapshotStore, type SnapshotStore } from '@xrkseek/client-runtime/client'

/** What the section renders. */
export interface ConfigurablePluginsTabState {
  /**
   * Whether the Host has answered once. The empty line waits for it: an
   * unanswered read is not the same statement as "this deployment configures
   * no plugin", and saying the second while the first is true would flash a
   * wrong answer on every open.
   */
  loaded: boolean
  /**
   * Namespaces to dispatch, in card registration order. After the Host answers
   * once every registered `settings.plugin.item` key is listed — Face-served
   * first-party cards and community self-keys alike. Order follows registrants,
   * not Face `describe` (async injection can reorder Host namespaces).
   */
  namespaces: string[]
}

/** The registration-side face the tab's slot entry injects. */
export interface ConfigurablePluginsTabFace {
  hooks: {
    /** Section snapshot bound by the renderer as usePluginConfigSection. */
    configurablePlugins: SnapshotStore<ConfigurablePluginsTabState>
  }
}

/** Reads Host describe once, then pairs every registered card with the tab. */
export class ConfigurablePluginsTabController {
  private readonly store = createSnapshotStore<ConfigurablePluginsTabState>({ loaded: false, namespaces: [] })
  private loaded = false
  private generation = 0
  private disposed = false

  /**
   * @param api - settings wire face.
   * @param entries - reads the cards currently registered into the section's slot.
   */
  constructor(
    private readonly api: Pick<IApiClient, 'settings'>,
    private readonly entries: () => readonly StoredEntry[],
  ) {}

  /** Opaque read of {@link disposed}: control flow cannot narrow it across awaits. */
  private isDisposed(): boolean {
    return this.disposed
  }

  /**
   * Wait for one successful Host `settings.describe`, then republish.
   * @returns settlement after the read, or immediately once disposed.
   */
  async load(): Promise<void> {
    if (this.isDisposed()) return
    const generation = ++this.generation
    let response: Awaited<ReturnType<IApiClient['settings']['describe']>>
    try {
      response = await this.api.settings.describe({})
    } catch (_settingsReadFailure) {
      // The tab keeps the namespaces it last knew; the next invalidation
      // or reconnect reads again.
      return
    }
    if (this.isDisposed() || generation !== this.generation || !response.result.ok) return
    this.loaded = true
    this.publish()
  }

  /** Republish after the slot ledger changed; a card registered late joins here. */
  refresh(): void {
    if (this.disposed) return
    this.publish()
  }

  /** Stop publishing; an in-flight read settles without touching the store. */
  dispose(): void {
    this.disposed = true
    this.generation += 1
  }

  /**
   * Build the face the tab's slot registration injects.
   * @returns the tab's snapshot source.
   */
  inject(): ConfigurablePluginsTabFace {
    return { hooks: { configurablePlugins: this.store } }
  }

  private publish(): void {
    // After the Host answers once: dispatch every registered card key.
    // Face-served first-party namespaces still register cards here; community
    // plugins (modlens · modsearch · wallet · …) register keys Face never
    // lists — they self-host config via dsh-compat HTTP, so filtering to Face
    // alone left those cards mounted but never rendered ("装了没反应").
    const namespaces = !this.loaded
      ? []
      : this.entries().flatMap((entry) =>
          entry.options.key !== undefined ? [entry.options.key] : [],
        ).filter((key, index, all) => all.indexOf(key) === index)
    const previous = this.store.getSnapshot()
    // Every settings-document commit re-reads, and most of them change nothing
    // this section shows. An observable source must keep its snapshot
    // reference until the fact moves, or each unrelated save re-renders the
    // whole card list (packages/client/AGENTS.md reactive rule 5).
    if (previous.loaded === this.loaded
      && previous.namespaces.length === namespaces.length
      && previous.namespaces.every((ns, index) => ns === namespaces[index])) return
    this.store.set({ loaded: this.loaded, namespaces })
  }
}
