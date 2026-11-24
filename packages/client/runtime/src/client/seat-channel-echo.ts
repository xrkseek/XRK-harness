/**
 * Optimistic seat prefix for delegated-child echoes — retired.
 * Owner is `user/message.source` (identity chip); do not stamp `[老板]` into body.
 */

type BossLabelResolve = () => string

let resolveBossLabel: BossLabelResolve | undefined

/** Wire Settings boss formal（nick） from ui-plan presence prefs (kept for bind). */
export function bindSeatChannelBossLabel(resolve: BossLabelResolve): void {
  resolveBossLabel = resolve
}

/** `@deprecated` kept for call-site stability — returns `[label]` shape only. */
export function formatSeatChannelEchoPrefix(label: string): string {
  const name = label.trim() || '?'
  return `[${name}]`
}

/** No-op — Face no longer prefixes child admits; echo must match. */
export function withSeatChannelEchoPrefix(text: string): string {
  void resolveBossLabel
  return text
}
