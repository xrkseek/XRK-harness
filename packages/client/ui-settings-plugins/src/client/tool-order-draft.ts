/**
 * Draft codec for Face `agent-loop.toolOrder` (DSH rest marker = single space).
 * Kept free of client-runtime imports so Node vitest can exercise it.
 */

/** DSH rest marker stored in `toolOrder` (single space string). */
export const TOOL_ORDER_REST = ' '

/** Write shape compatible with `CardForm` field parses. */
export type ToolOrderWrite =
  | { kind: 'set'; value: string[] }
  | { kind: 'clear' }

/**
 * Format a Face `toolOrder` array as comma-separated draft text.
 * The rest marker renders as an empty slot (`bash, , read_file`).
 */
export function formatToolOrder(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return ''
  if (!value.every((x) => typeof x === 'string')) return ''
  return value
    .map((part) => (part === TOOL_ORDER_REST ? '' : part))
    .join(', ')
}

/**
 * Parse comma-separated draft text into a `toolOrder` write.
 * Empty draft clears. Exactly one empty slot is the rest marker.
 */
export function parseToolOrder(text: string): ToolOrderWrite | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'clear' }
  const parts = trimmed.split(',').map((part) => part.trim())
  if (parts.length === 0) return { kind: 'clear' }
  let restCount = 0
  const order: string[] = []
  for (const part of parts) {
    if (part === '' || part === TOOL_ORDER_REST) {
      restCount += 1
      order.push(TOOL_ORDER_REST)
      continue
    }
    order.push(part)
  }
  if (restCount !== 1) return undefined
  const names = order.filter((x) => x !== TOOL_ORDER_REST)
  if (names.length === 0) return undefined
  if (new Set(names).size !== names.length) return undefined
  return { kind: 'set', value: order }
}
