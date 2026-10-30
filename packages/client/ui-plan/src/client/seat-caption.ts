/**
 * Seat chrome caption: `老板 · {nick}` / `经理 · {nick}` / `干员 · {nick}`.
 * Empty / echo name → role only.
 */
export function delegateSeatCaption(role: string, name: string | undefined): string {
  const n = name?.trim()
  // Skip when Face echoes the same seat word, or a full `经理（老王）` already.
  if (!n || n === 'untitled' || n === role) return role
  if (n.startsWith(role)) {
    const rest = n.slice(role.length).trim()
    if (!rest || rest.startsWith('（') || rest.startsWith('(') || rest.startsWith('·')) {
      return n
    }
  }
  return `${role} · ${n}`
}

/** Face `delegate.childSeat` — which Settings title prefixes the child ball. */
export type DelegateChildSeat = 'manager' | 'agent' | 'sunflower'

/**
 * Right-seat caption for Overview dual-ball.
 *
 * 经理 / 干员 are **identities**, not org ranks: project office home → 经理;
 * identity agent-homes and tool children → 干员; 向日葵 is name-only.
 * Missing `childSeat` (old Host / pending status) defaults to 干员 so a
 * delegated 测员 is never mislabeled 经理 while status catches up.
 */
export function childDelegateSeatCaption(
  seatTitles: { readonly manager: string; readonly agent: string },
  childSeat: DelegateChildSeat | undefined,
  childLabel: string | undefined,
): string {
  if (childSeat === 'sunflower') {
    const n = childLabel?.trim()
    return n && n !== 'untitled' ? n : '向日葵'
  }
  const role = childSeat === 'manager' ? seatTitles.manager : seatTitles.agent
  return delegateSeatCaption(role, childLabel)
}
