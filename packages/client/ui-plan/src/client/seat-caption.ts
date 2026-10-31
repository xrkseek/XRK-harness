/**
 * Seat chrome caption: role + member display.
 *
 * - Face already sent `经理（老王）` (formal equals seat word) → keep as-is.
 * - Agent formal（nick） → `干员 · 创业作业（成经吴）` (· avoids nested parens).
 * - Boss Settings nick only → `老板（成总）` (see parentDelegateSeatCaption).
 * Empty / echo name → role only. Titles are Settings-custom (never hardcode).
 */
export function delegateSeatCaption(role: string, name: string | undefined): string {
  const n = name?.trim()
  if (!n || n === 'untitled' || n === role) return role
  // Skip when Face already composed `经理（老王）` / `经理 · …`.
  if (n.startsWith(role)) {
    const rest = n.slice(role.length).trim()
    if (!rest || rest.startsWith('（') || rest.startsWith('(') || rest.startsWith('·')) {
      return n
    }
  }
  return `${role} · ${n}`
}

/**
 * Compose roster formal + optional nick (`创业作业（成经吴）`), matching Host
 * `displayMemberName`.
 */
export function memberDisplayLabel(
  formal: string | undefined,
  nickname: string | null | undefined,
): string | undefined {
  const name = formal?.trim()
  if (!name) {
    const nick = typeof nickname === 'string' ? nickname.trim() : ''
    return nick || undefined
  }
  if (nickname === undefined) return name
  const nick = (nickname ?? '').trim()
  return nick ? `${name}（${nick}）` : name
}

/** Face `delegate.childSeat` — which Settings title prefixes the child ball. */
export type DelegateChildSeat = 'manager' | 'agent' | 'sunflower'

/**
 * Left-seat caption for Overview dual-ball.
 *
 * Office home (project / agent-home / 向阳): human face → Settings boss title + nick.
 * Tool child: Face `delegate.parentLabel` is already the immediate parent seat
 * (manager / agent / sunflower formal（nick）) — do **not** re-prefix with boss
 * (that painted「老板 · 经理」on child Overview).
 */
export function parentDelegateSeatCaption(
  bossTitle: string,
  options: {
    readonly officeBossSeat: boolean
    readonly bossNickname?: string
    readonly parentLabel?: string
    /** Fallback when child status has no parentLabel yet. */
    readonly managerTitle: string
  },
): string {
  if (options.officeBossSeat) {
    const nick = options.bossNickname?.trim()
    return nick ? `${bossTitle}（${nick}）` : bossTitle
  }
  const fromFace = options.parentLabel?.trim()
  if (fromFace && fromFace !== 'untitled') return fromFace
  return options.managerTitle
}

/**
 * Right-seat caption for Overview dual-ball.
 *
 * manager / agent are **identities**, not org ranks: project office home → manager;
 * identity agent-homes and tool children → agent; sunflower = 经理席对位
 * (`经理 · 向日葵（xrkseek）`). Old Hosts may still send `childSeat: sunflower`.
 * Missing `childSeat` defaults to agent so a delegated worker is never
 * mislabeled manager while status catches up.
 */
export function childDelegateSeatCaption(
  seatTitles: { readonly manager: string; readonly agent: string },
  childSeat: DelegateChildSeat | undefined,
  childLabel: string | undefined,
): string {
  if (childSeat === 'sunflower') {
    return delegateSeatCaption(
      seatTitles.manager,
      childLabel?.trim() || '向日葵',
    )
  }
  const role = childSeat === 'manager' ? seatTitles.manager : seatTitles.agent
  return delegateSeatCaption(role, childLabel)
}

/**
 * Prefer optimistic Team nick (`null` clears) over Face label.
 * `undefined` live = no local patch → keep Face.
 * When `liveFormal` is set, paint `formal（nick）` so both names stay visible.
 * Without formal, the seat role is the formal (`经理（老王）`).
 */
export function withLiveNickname(
  role: string,
  faceLabel: string | undefined,
  liveNickname: string | null | undefined,
  liveFormal?: string | null,
): string {
  if (liveNickname !== undefined) {
    const formal = liveFormal?.trim() || role
    const composed = memberDisplayLabel(formal, liveNickname)
    return delegateSeatCaption(role, composed)
  }
  const fromFace = faceLabel?.trim()
  if (fromFace && fromFace !== 'untitled') return fromFace
  return role
}
