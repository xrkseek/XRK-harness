/**
 * Minimal browser-test helpers (see index.js).
 */

/** Build a translate stub over plain dictionaries. */
export function makeTranslate(
  ...dicts: readonly Record<string, string>[]
): (key: string, params?: Record<string, unknown>) => string

/** Bind a bare observable snapshot source to a uSES selector hook. */
export function bindSnapshotSelector<T>(
  w: { subscribe(fn: () => void): unknown; getSnapshot(): T },
): <S>(sel: (s: T) => S, eq?: (a: S, b: S) => boolean) => S
