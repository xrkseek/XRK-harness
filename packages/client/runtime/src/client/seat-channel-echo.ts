/**
 * Optimistic `[seat…]` prefix for delegated-child echoes — mirrors Face
 * `withSeatChannelPrefix` so the bubble does not wait on the Host round-trip.
 */

type BossLabelResolve = () => string

let resolveBossLabel: BossLabelResolve | undefined

/** Wire Settings boss formal（nick） from ui-plan presence prefs. */
export function bindSeatChannelBossLabel(resolve: BossLabelResolve): void {
  resolveBossLabel = resolve
}

/** `[label]` channel marker — same shape as Face `formatSeatChannelPrefix`. */
export function formatSeatChannelEchoPrefix(label: string): string {
  const name = label.trim() || '?'
  return `[${name}]`
}

/**
 * Prepend the live boss seat marker for subagent echo text.
 * No-op when unbound / empty / already tagged.
 */
export function withSeatChannelEchoPrefix(text: string): string {
  const body = text.trimStart()
  if (!body) return text
  const label = resolveBossLabel?.()?.trim()
  if (!label) return text
  const prefix = formatSeatChannelEchoPrefix(label)
  if (body.startsWith(prefix)) return text
  if (/^\[[^\]]+\]\s/.test(body)) return text
  return `${prefix} ${body}`
}
