/**
 * Wake the community side card (`xrkh-better-sidebar`) from the session-header
 *「文件」button when the builtin workbench panel has yielded.
 */

/** Seed passed to community `openTab` (path opens an editor when supported). */
export type BetterSidebarOpenTabSeed = {
  readonly type: string
  readonly path?: string
}

/** Minimal community side-card surface the header toggle needs. */
export interface BetterSidebarFace {
  openTab?(seed: BetterSidebarOpenTabSeed): void
  getTabs?(): readonly { readonly id: string }[]
  isTabEnabled?(id: string): boolean
  getSnapshot?(): { readonly state?: { readonly panelOpen?: boolean } } | undefined
  subscribeState?(listener: () => void): () => void
}

/** Prefer editor (files) then other built-in tab types when waking the side card. */
const COMMUNITY_TAB_PREFERENCE = ['editor', 'browser', 'terminal', 'subagent'] as const

/**
 * Open (or focus) the community side card.
 * @param face - `ctx.betterSidebar` when present.
 * @param options.path - optional workspace path to open in the editor tab.
 */
export function openCommunitySidebar(
  face: BetterSidebarFace | undefined,
  options: { readonly path?: string } = {},
): void {
  if (face?.openTab === undefined) return
  const tabs = face.getTabs?.() ?? []
  const enabled = (id: string): boolean => face.isTabEnabled?.(id) !== false
  const preferred = COMMUNITY_TAB_PREFERENCE.find(
    id => enabled(id) && (tabs.length === 0 || tabs.some(tab => tab.id === id)),
  )
  const fallback = tabs.find(tab => enabled(tab.id))?.id
  const type = preferred ?? fallback
  if (type === undefined) return
  const path = options.path?.trim()
  face.openTab(path ? { type, path } : { type })
}
