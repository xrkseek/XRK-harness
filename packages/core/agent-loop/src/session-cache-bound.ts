/**
 * Cap process-local per-session Maps so Host long-runs do not retain every
 * historical sessionId forever. Insertion order = LRU when we re-set on touch.
 */

/** Soft ceiling; roughly “resident + recent remounts”, not full history. */
export const SESSION_PROCESS_CACHE_MAX = 64;

/** Insert/refresh `key` and drop the oldest entries when over capacity. */
export function rememberSessionCache<V>(
  map: Map<string, V>,
  key: string,
  value: V,
  max = SESSION_PROCESS_CACHE_MAX,
): void {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
