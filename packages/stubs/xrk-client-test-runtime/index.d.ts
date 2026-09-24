/**
 * Minimal browser-test helpers (see index.js).
 */

/** Build a translate stub over plain dictionaries. */
export function makeTranslate(
  ...dicts: readonly Record<string, string>[]
): (key: string, params?: Record<string, unknown>) => string
