/**
 * Per-session last-good catalogs for Runtime (session.tools) and Inject
 * (skill.list / skill.read). Switching sessions paints the cached frame
 * immediately, then a background refresh replaces it. Bounded LRU so a long
 * sidebar does not retain every catalog forever.
 */

const MAX_ENTRIES = 16

export function rememberCatalog<T>(store: Map<string, T>, key: string, value: T): void {
  if (store.has(key)) store.delete(key)
  store.set(key, value)
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}

export const toolsCatalogCache = new Map<string, unknown>()
export const skillsCatalogCache = new Map<string, unknown>()
export const skillBodyCache = new Map<string, string>()

/** Most recent successful payload, used when this session has no row yet. */
let lastTools: unknown
let lastSkills: unknown

export function paintToolsCatalog(sessionId: string): { value: unknown; owned: boolean } | undefined {
  const own = toolsCatalogCache.get(sessionId)
  if (own !== undefined) return { value: own, owned: true }
  if (lastTools !== undefined) return { value: lastTools, owned: false }
  return undefined
}

export function paintSkillsCatalog(sessionId: string): { value: unknown; owned: boolean } | undefined {
  const own = skillsCatalogCache.get(sessionId)
  if (own !== undefined) return { value: own, owned: true }
  if (lastSkills !== undefined) return { value: lastSkills, owned: false }
  return undefined
}

export function rememberToolsCatalog(sessionId: string, value: unknown): void {
  lastTools = value
  rememberCatalog(toolsCatalogCache, sessionId, value)
}

export function rememberSkillsCatalog(sessionId: string, value: unknown): void {
  lastSkills = value
  rememberCatalog(skillsCatalogCache, sessionId, value)
}

/** Test-only: drop catalogs, chrome, and the cross-session last paint. */
export function resetCatalogPaintForTests(): void {
  toolsCatalogCache.clear()
  skillsCatalogCache.clear()
  skillBodyCache.clear()
  toolsChromeBySession.clear()
  skillsChromeBySession.clear()
  lastTools = undefined
  lastSkills = undefined
}

export type CatalogChrome = {
  query: string
  filter: string
  expanded: readonly string[]
  open: string | null
}

export const toolsChromeBySession = new Map<string, CatalogChrome>()
export const skillsChromeBySession = new Map<string, CatalogChrome>()

export function readChrome(store: Map<string, CatalogChrome>, sessionId: string): CatalogChrome {
  return store.get(sessionId) ?? { query: '', filter: 'all', expanded: [], open: null }
}

export function writeChrome(
  store: Map<string, CatalogChrome>,
  sessionId: string,
  chrome: CatalogChrome,
): void {
  rememberCatalog(store, sessionId, chrome)
}
