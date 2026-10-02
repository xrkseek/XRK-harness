/**
 * Per-session fingerprint cache for `useSyncExternalStore` getSnapshot.
 * Returns the previous value reference when the fingerprint is unchanged.
 */

export type SessionSnapshotCache<T> = {
  readonly get: (sessionId: string, fingerprint: string, build: () => T) => T
  readonly clear: (sessionId?: string) => void
}

/**
 * @param empty - Shared empty value returned when `fingerprint` is empty
 *   (or when `build` would allocate an empty payload). Pass a module-level
 *   constant — never `{}` / `[]` literals at the call site.
 */
export function createSessionSnapshotCache<T>(empty: T): SessionSnapshotCache<T> {
  const bySession = new Map<string, { readonly key: string; readonly value: T }>()
  return {
    get(sessionId, fingerprint, build) {
      if (fingerprint === '') {
        bySession.delete(sessionId)
        return empty
      }
      const prev = bySession.get(sessionId)
      if (prev !== undefined && prev.key === fingerprint) return prev.value
      const value = build()
      bySession.set(sessionId, { key: fingerprint, value })
      return value
    },
    clear(sessionId) {
      if (sessionId === undefined) bySession.clear()
      else bySession.delete(sessionId)
    },
  }
}
