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
  clearDshWorkbenchPushAliases,
  mirrorWorkbenchPushToDshAliases,
  XRK_WORKBENCH_CSS,
} from './dsh-style-aliases.ts'
import {
  applyLayoutInsetsDom,
  clearLayoutInsetsDom,
  EMPTY_LAYOUT_INSETS,
  LAYOUT_INSET_ATTR,
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
   * Live shell insets (details / left rail / bottom strip / phone). AppFrame
   * publishes columns; workbenches may {@link LayoutController.reserveBottom}.
   */
  readonly insets: LayoutInsetsFace
  /**
   * Canonical bottom-strip reservation (0 = closed). Updates
   * `--xrk-layout-inset-bottom`, stamps `--xrkh-workbench-height` for compat
   * skins, and survives AppFrame column republish. Prefer this over writing
   * the CSS var alone.
   */
  reserveBottom(height: number): void
  /**
   * Canonical side-strip reservation (0 = closed). Stamps
   * `--xrkh-workbench-width` so the shell frame yields (`margin-right`) and
   * DSH aliases stay aligned. Prefer this over writing the CSS var alone.
   */
  reserveSide(width: number): void
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
   * Publish solved column insets (AppFrame). Omitting `bottom` keeps the last
   * {@link reserveBottom} value so details/sidebar drags do not wipe the strip.
   */
  publishInsets(next: {
    readonly details: number
    readonly detailsOpen: boolean
    readonly sidebar: number
    readonly phone: boolean
    readonly bottom?: number
  }): void {
    const prev = this.#insets.getSnapshot()
    const merged: LayoutInsets = {
      details: next.details,
      detailsOpen: next.detailsOpen,
      sidebar: next.sidebar,
      phone: next.phone,
      bottom: next.bottom ?? prev.bottom,
    }
    if (layoutInsetsEqual(prev, merged)) return
    this.#insets.set(merged)
    applyLayoutInsetsDom(merged)
  }

  /**
   * Canonical bottom-strip reservation (CSS pixels; 0 = closed).
   * Stamps the workbench-height compat var so AppFrame / DSH aliases / CSS-only
   * readers stay on one number.
   */
  reserveBottom(height: number): void {
    const bottom = Math.max(0, Math.round(height))
    const root = document.documentElement
    root.style.setProperty(XRK_WORKBENCH_CSS.height, `${bottom}px`)
    if (bottom > 0) root.setAttribute(LAYOUT_INSET_ATTR.bottom, '')
    else root.removeAttribute(LAYOUT_INSET_ATTR.bottom)
    mirrorWorkbenchPushToDshAliases()
    const prev = this.#insets.getSnapshot()
    this.publishInsets({
      details: prev.details,
      detailsOpen: prev.detailsOpen,
      sidebar: prev.sidebar,
      phone: prev.phone,
      bottom,
    })
  }

  /**
   * Canonical side-strip reservation (CSS pixels; 0 = closed).
   * The shell frame reads `--xrkh-workbench-width` as `margin-right` so the
   * in-flow columns yield instead of painting under the fixed panel.
   * Also stamps {@link LAYOUT_INSET_ATTR.side} so Host chrome (header pad /
   * PresenceDock) can select without knowing a first-party plugin id.
   */
  reserveSide(width: number): void {
    const side = Math.max(0, Math.round(width))
    const root = document.documentElement
    root.style.setProperty(XRK_WORKBENCH_CSS.width, `${side}px`)
    if (side > 0) root.setAttribute(LAYOUT_INSET_ATTR.side, '')
    else root.removeAttribute(LAYOUT_INSET_ATTR.side)
    mirrorWorkbenchPushToDshAliases()
  }

  /** Clear published insets (AppFrame unmount). */
  clearInsets(): void {
    const root = document.documentElement
    root.style.removeProperty(XRK_WORKBENCH_CSS.width)
    root.style.removeProperty(XRK_WORKBENCH_CSS.height)
    root.removeAttribute(LAYOUT_INSET_ATTR.side)
    root.removeAttribute(LAYOUT_INSET_ATTR.bottom)
    clearDshWorkbenchPushAliases()
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
