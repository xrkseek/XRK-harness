/**
 * LayoutController: the cross-plugin panel-action face behind ctx.layout.
 * Panel geometry itself lives in the root entry's layout store (stores.ts);
 * the current-session selection lives with the runtime sessions service, and
 * the per-session active view dissolved into ui-conversation's session store
 * (its only consumer). What remains here is the contract other plugins'
 * apply worlds reach for panel transitions (sidebar toggle from ui-sidebar,
 * details open/close from ui-conversation) — writes stay inside the store's
 * declared action set, delivered as the registration's bound actions —
 * plus {@link LayoutInsets} published by AppFrame for floating workbenches.
 */
import { createSnapshotStore, type SnapshotStore } from '@xrkseek/client-runtime/client'
import type { BoundActions } from '@xrkseek/client-ui-slots'
import type { createLayoutStore } from './stores.ts'
import {
  applyLayoutInsetsDom,
  clearLayoutInsetsDom,
  EMPTY_LAYOUT_INSETS,
  layoutInsetsEqual,
  type LayoutInsets,
  type LayoutInsetsFace,
} from './layout-insets.ts'

/** The layout store's bound action set (framework-baked, draft params peeled). */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>

/**
 * The outward layout face (`ctx.layout`): panel transitions plus live shell
 * insets for workbench plugins. Test fakes must supply the three actions;
 * `insets` defaults to empty when constructing {@link LayoutController}.
 */
export interface ILayout {
  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void
  /** Open the details panel (no-op when already open). */
  openDetails(): void
  /** Close the details panel. */
  closeDetails(): void
  /**
   * Live shell insets (details / left rail / phone). AppFrame is the sole
   * publisher; workbench plugins subscribe or read CSS variables from
   * `layout-insets.ts`.
   */
  readonly insets: LayoutInsetsFace
}

/** Cross-plugin panel-action + insets face (ctx.layout). */
export class LayoutController implements ILayout {
  #panels: PanelActions | undefined
  readonly #insets: SnapshotStore<LayoutInsets> = createSnapshotStore(EMPTY_LAYOUT_INSETS)

  /** {@inheritdoc ILayout.insets} */
  get insets(): LayoutInsetsFace {
    return this.#insets
  }

  /**
   * Adopt the root entry's bound store actions. Called from the root
   * registration's inject hook (a sanctioned assembly side effect), so the
   * face is live from the entry's first render; on entry re-register the
   * fresh actions overwrite the stale set.
   * @param actions - bound actions of the entry's layout store instance.
   */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  /**
   * Publish solved column insets (AppFrame only). Updates `insets` and the
   * document CSS contract. No-op when equal to the last publish.
   */
  publishInsets(next: LayoutInsets): void {
    const prev = this.#insets.getSnapshot()
    if (layoutInsetsEqual(prev, next)) return
    this.#insets.set(next)
    applyLayoutInsetsDom(next)
  }

  /** Clear published insets (AppFrame unmount). */
  clearInsets(): void {
    this.#insets.set(EMPTY_LAYOUT_INSETS)
    clearLayoutInsetsDom()
  }

  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Open the details panel (no-op when already open). */
  openDetails(): void {
    this.#require().openDetails()
  }

  /** Close the details panel. */
  closeDetails(): void {
    this.#require().closeDetails()
  }

  #require(): PanelActions {
    // Callers are UI gestures, which cannot fire before the root entry
    // rendered (the inject hook runs in its first render) — reaching this
    // unwired is a boot-order bug, not a race to tolerate.
    if (this.#panels === undefined) throw new Error('layout: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}

export type { LayoutInsets, LayoutInsetsFace }
