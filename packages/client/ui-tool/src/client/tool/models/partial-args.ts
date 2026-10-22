/**
 * Field-level reads from a still-open JSON object prefix (streaming tool args).
 * Presentation only — does not replace full `JSON.parse` once the object closes.
 * @module
 */

/**
 * Extract a JSON string value for `key` from an incomplete object prefix when
 * the value's closing quote has already arrived. Returns undefined while the
 * field is absent or still open.
 */
export function readPartialStringField(
  argsRaw: string,
  key: string,
): string | undefined {
  if (argsRaw === '' || key === '') return undefined
  // "key"\s*:\s*"value..."
  const re = new RegExp(
    `"${escapeRegExp(key)}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`,
  )
  const match = re.exec(argsRaw)
  if (match === null) return undefined
  try {
    return JSON.parse(`"${match[1]}"`) as string
  } catch {
    return match[1]
  }
}

/** Prefer the first closed string field among `keys`. */
export function readPartialStringFields(
  argsRaw: string,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = readPartialStringField(argsRaw, key)
    if (value !== undefined && value !== '') return value
  }
  return undefined
}

/**
 * Approximate streamed content length in 1024-char units once `"content"`'s
 * opening quote is seen (value may still be open).
 */
export function readPartialContentUnits(argsRaw: string): number | undefined {
  const m = /"content"\s*:\s*"/.exec(argsRaw)
  if (m === null || m.index === undefined) return undefined
  const start = m.index + m[0].length
  let i = start
  let chars = 0
  while (i < argsRaw.length) {
    const c = argsRaw[i]!
    if (c === '\\') {
      i += 2
      chars += 1
      continue
    }
    if (c === '"') break
    i += 1
    chars += 1
  }
  return Math.max(1, Math.ceil(chars / 1024))
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
