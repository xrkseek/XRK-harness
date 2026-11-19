/**
 * Product-safe soft remount / unload for user overlay client plugins.
 *
 * Full `@xrkseek/client-hmr` (file-watch + Cordis UI) stays omitted from product
 * boot. This helper adopts / hot-swaps / removes overlay rows the Host already
 * staged under `/plugins/<id>/client.js`, so Settings install / enable /
 * update / disable / delete can update the shell without a hard refresh when
 * unload succeeds.
 */
import type { Context } from '@xrkseek/cordis'
import type { Entry, Loader } from '@xrkseek/cordis-plugin-loader'
import type { ClientModuleLoader } from '@xrkseek/client-modules/client'

/** One overlay boot row from Face `pluginInventory/clientBoot`. */
export interface ClientBootOverlayEntry {
  readonly id: string
  readonly url: string
  readonly rev: string
  readonly inject?: readonly string[]
}

/** Overlay graph the Host publishes after live boot refresh. */
export interface ClientBootOverlay {
  readonly rev: string
  readonly entries: readonly ClientBootOverlayEntry[]
}

/**
 * Diff of previous id→rev vs next Host overlay.
 * Shrink and grow can both be non-empty in one tick (delete A + install B).
 */
export interface OverlayRemountPlan {
  readonly removed: readonly string[]
  readonly delta: readonly ClientBootOverlayEntry[]
}

/**
 * Compare previous id→rev map with the next Host overlay.
 * @returns ids that left the overlay + rows that are new or rev-bumped.
 */
export function planOverlayRemount(
  previous: ReadonlyMap<string, string>,
  overlay: ClientBootOverlay,
): OverlayRemountPlan {
  const nextIds = new Set(overlay.entries.map((e) => e.id))
  const removed: string[] = []
  for (const id of previous.keys()) {
    if (!nextIds.has(id)) removed.push(id)
  }

  const delta: ClientBootOverlayEntry[] = []
  for (const row of overlay.entries) {
    const prevRev = previous.get(row.id)
    if (prevRev === undefined || prevRev !== row.rev) {
      delta.push(row)
    }
  }
  return { removed, delta }
}

/** Snapshot id→rev from an overlay (for session tracking). */
export function overlayRevMap(
  overlay: ClientBootOverlay,
): Map<string, string> {
  return new Map(overlay.entries.map((e) => [e.id, e.rev]))
}

/**
 * Ensure overlay script URL carries the current `rev` query for cache bust.
 * Replaces a stale `rev=` when the field and query disagree.
 */
export function ensureOverlayUrlRev(url: string, rev: string): string {
  const safe = rev || '0'
  const encoded = encodeURIComponent(safe)
  if (/[?&]rev=/.test(url)) {
    return url.replace(/([?&]rev=)[^&#]*/, `$1${encoded}`)
  }
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}rev=${encoded}`
}

/** Normalize every overlay row URL to include matching `?rev=`. */
export function normalizeOverlayUrls(
  overlay: ClientBootOverlay,
): ClientBootOverlay {
  return {
    rev: overlay.rev,
    entries: overlay.entries.map((e) => ({
      ...e,
      url: ensureOverlayUrlRev(e.url, e.rev),
    })),
  }
}

function findEntry(loader: Loader, id: string): Entry | undefined {
  for (const entry of loader.entries()) {
    if (entry.options.name === id) return entry
  }
  return undefined
}

function removeOwnedStyles(id: string): void {
  if (typeof document === 'undefined') return
  for (const el of document.querySelectorAll('style[data-plugin]')) {
    if (el.getAttribute('data-plugin') === id) el.remove()
  }
}

/**
 * Hot-swap one already-mounted overlay entry (invalidate → prefetch → refresh).
 */
async function reloadExisting(
  modules: ClientModuleLoader,
  loader: Loader,
  id: string,
): Promise<boolean> {
  const entry = findEntry(loader, id)
  if (entry === undefined) return false
  modules.invalidate(id)
  await modules.prefetch(id)
  const oldFiber = entry.fiber
  if (oldFiber !== undefined) {
    const runtime = oldFiber.runtime
    if (runtime !== null) entry.ctx.registry.delete(runtime.callback)
    while (oldFiber.inertia !== undefined) await oldFiber.inertia
    delete entry.fiber
  }
  removeOwnedStyles(id)
  await entry.refresh()
  if (entry.fiber === undefined) return false
  await entry.fiber.await()
  return true
}

/**
 * Soft-remount overlay client plugins into the live product shell.
 * Pass `delta` to only create/reload changed rows.
 */
export async function softRemountClientOverlay(
  ctx: Context,
  overlay: ClientBootOverlay,
  delta?: readonly ClientBootOverlayEntry[],
): Promise<{ readonly mounted: readonly string[]; readonly failed: readonly string[] }> {
  const modules = ctx.get('modules') as ClientModuleLoader | undefined
  const loader = ctx.get('loader') as Loader | undefined
  const rows = delta ?? overlay.entries
  if (modules === undefined || loader === undefined) {
    return { mounted: [], failed: rows.map((e) => e.id) }
  }

  const mounted: string[] = []
  const failed: string[] = []

  for (const row of rows) {
    try {
      const existing = findEntry(loader, row.id)
      const url = ensureOverlayUrlRev(row.url, row.rev)
      modules.adopt({ id: row.id, url, rev: row.rev })
      if (existing === undefined) {
        await modules.prefetch(row.id)
        const entryId = await loader.create({ name: row.id })
        const entry = loader.resolve(entryId)
        if (entry.fiber === undefined) {
          failed.push(row.id)
          continue
        }
        await entry.fiber.await()
        mounted.push(row.id)
        continue
      }
      const ok = await reloadExisting(modules, loader, row.id)
      if (ok) mounted.push(row.id)
      else failed.push(row.id)
    } catch {
      failed.push(row.id)
    }
  }

  return { mounted, failed }
}

/**
 * Unload overlay client plugins that left the Host boot graph (disable / delete).
 * Uses Loader.remove (official deletion path), not bare fiber.dispose.
 * Later-mounted ids are unloaded first (often dependents of earlier overlays).
 */
export async function softUnloadClientOverlay(
  ctx: Context,
  ids: readonly string[],
): Promise<{ readonly unloaded: readonly string[]; readonly failed: readonly string[] }> {
  const modules = ctx.get('modules') as ClientModuleLoader | undefined
  const loader = ctx.get('loader') as Loader | undefined
  if (modules === undefined || loader === undefined) {
    return { unloaded: [], failed: [...ids] }
  }

  const unloaded: string[] = []
  const failed: string[] = []
  // Reverse insertion / list order: dependents (office after sidebar) go first.
  const ordered = [...ids].toReversed()

  for (const id of ordered) {
    try {
      const entry = findEntry(loader, id)
      if (entry === undefined) {
        modules.invalidate(id)
        removeOwnedStyles(id)
        unloaded.push(id)
        continue
      }
      await loader.remove(entry.options.id)
      modules.invalidate(id)
      removeOwnedStyles(id)
      unloaded.push(id)
    } catch {
      failed.push(id)
    }
  }

  return { unloaded, failed }
}

/** Mutable overlay boot tracking owned by the Settings apply lifetime. */
export type OverlayBootSessionState = {
  lastRevs: Map<string, string>
  /**
   * Sticky while soft unload still has outstanding failures.
   * Cleared when unload succeeds or the Host graph no longer asks to remove.
   */
  unloadPending: boolean
}

export type OverlayBootApplyResult = {
  readonly unloadFailed: boolean
  readonly remountFailed: boolean
}

/**
 * Diff + soft unload/remount against session state.
 * Updates `lastRevs` only for rows that actually unloaded or remounted so the
 * next identical Host boot still retries failures.
 */
export async function applyOverlayBootPlan(
  ctx: Context,
  session: OverlayBootSessionState,
  overlay: ClientBootOverlay,
): Promise<OverlayBootApplyResult> {
  const plan = planOverlayRemount(session.lastRevs, overlay)

  let unloadFailed = false
  if (plan.removed.length > 0) {
    const unloaded = await softUnloadClientOverlay(ctx, plan.removed)
    for (const id of unloaded.unloaded) {
      session.lastRevs.delete(id)
    }
    if (unloaded.failed.length > 0) {
      unloadFailed = true
      session.unloadPending = true
    } else {
      session.unloadPending = false
    }
  } else if (session.unloadPending) {
    // Re-enable / Host restored the id before unload retried — nothing left to drop.
    session.unloadPending = false
  }

  let remountFailed = false
  if (plan.delta.length > 0) {
    const remounted = await softRemountClientOverlay(ctx, overlay, plan.delta)
    const revById = new Map(overlay.entries.map((e) => [e.id, e.rev]))
    for (const id of remounted.mounted) {
      const rev = revById.get(id)
      if (rev !== undefined) session.lastRevs.set(id, rev)
    }
    if (remounted.failed.length > 0) remountFailed = true
  }

  return { unloadFailed, remountFailed }
}
