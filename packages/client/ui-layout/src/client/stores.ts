/**
 * The root entry's transient layout store: panel geometry as plain widths in
 * px (0 = closed). Module level exports the factory only — a module-level
 * handle would pin the store's identity in the module
 * cache (a de-facto singleton surviving plugin reloads). register() receives
 * the factory (exclusive use: the framework instantiates per entry), AppFrame
 * derives its PropsStore share from the return type, and the service face
 * receives the bound actions through the registration's inject hook.
 *
 * Overview (details) open + width are Session-scoped in AppFrame
 * (`details-open-memory`, localStorage). `detailsLast` is the live shell
 * preference for the *current* Session only — not a cross-Session habit.
 */
import { defineStore, type EngineStoreHandle } from '@xrkseek/client-runtime/client'
import {
  clampWidth, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'

/**
 * Layout store state: panel width preferences in px (0 = closed), plus the
 * narrow-viewport pair — `narrow` mirrors AppFrame's breakpoint reading
 * (viewport < SIDEBAR_AUTO_COLLAPSE) so toggleSidebar can pick semantics, and
 * `narrowExpanded` is the manual override that re-expands the auto-collapsed
 * sidebar over the squeezed center without rewriting the width preference.
 * `detailsLast` is the last non-zero Overview width for the active Session.
 */
type LayoutState = {
  sidebar: number
  details: number
  detailsLast: number
  narrow: boolean
  narrowExpanded: boolean
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type LayoutActions = {
  setSidebar: (draft: LayoutState, px: number) => void
  setDetails: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  openDetails: (draft: LayoutState) => void
  closeDetails: (draft: LayoutState) => void
  /** Apply per-Session Overview chrome (open bit + remembered width). */
  restoreDetailsChrome: (
    draft: LayoutState,
    chrome: { readonly open: boolean; readonly width: number },
  ) => void
}

/**
 * Create the layout panel store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions>  {
  const handle = defineStore({
    init: (): LayoutState => ({
      sidebar: SIDEBAR_DEFAULT,
      details: 0,
      detailsLast: DETAILS_DEFAULT,
      narrow: false,
      narrowExpanded: false,
    }),
    actions: {
      setSidebar: (d, px: number) => { d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) },
      setDetails: (d, px: number) => {
        d.details = clampWidth(px, DETAILS_MIN, DETAILS_MAX)
        d.detailsLast = d.details
      },
      // Narrow toggles flip only the override: the width preference survives
      // untouched, so re-widening restores the pre-squeeze layout.
      toggleSidebar: (d) => {
        if (d.narrow) d.narrowExpanded = !d.narrowExpanded
        else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      // Crossing the breakpoint in either direction drops the override: the
      // narrow default is auto-collapsed, the wide state is the preference.
      setNarrow: (d, narrow: boolean) => {
        if (d.narrow === narrow) return
        d.narrow = narrow
        d.narrowExpanded = false
      },
      openDetails: (d) => {
        if (d.details === 0) d.details = d.detailsLast
      },
      closeDetails: (d) => {
        if (d.details > 0) d.detailsLast = d.details
        d.details = 0
      },
      restoreDetailsChrome: (d, chrome) => {
        d.detailsLast = clampWidth(chrome.width, DETAILS_MIN, DETAILS_MAX)
        d.details = chrome.open ? d.detailsLast : 0
      },
    },
  })
  return handle
}
