/**
 * Seat chrome caption: `老板 · {nick}` / `经理 · {nick}`.
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
