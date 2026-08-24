/**
 * Browser runtime diagnostics (AGT-style scoped logger, XRK-owned).
 *
 * Level: `?xrkLog=` / `localStorage.XRK_LOG` / `window.__XRK_LOG__` / default `info`.
 * Ring buffer: `window.__XRK_DIAG__.recent` (last 80 lines) for DevTools inspect.
 */

export type DiagLevel = 'debug' | 'info' | 'warn' | 'error'

const RANK: Record<DiagLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const RING_CAP = 80

export interface DiagRecord {
  readonly ts: string
  readonly level: DiagLevel
  readonly ns: string
  readonly message: string
  readonly detail?: unknown
}

export interface Diag {
  readonly ns: string
  debug(message: string, detail?: unknown): void
  info(message: string, detail?: unknown): void
  warn(message: string, detail?: unknown): void
  error(message: string, detail?: unknown): void
  child(scope: string): Diag
}

interface DiagGlobals {
  recent: DiagRecord[]
  level: DiagLevel
}

declare global {
  interface Window {
    __XRK_LOG__?: string
    __XRK_DIAG__?: DiagGlobals
  }
}

function parseLevel(raw: string | undefined | null): DiagLevel | undefined {
  if (!raw) return undefined
  const v = raw.trim().toLowerCase()
  if (v === 'debug' || v === 'info' || v === 'warn' || v === 'error') return v
  return undefined
}

function resolveLevel(): DiagLevel {
  if (typeof window !== 'undefined') {
    try {
      const params = new URLSearchParams(window.location.search)
      const fromQuery = parseLevel(params.get('xrkLog'))
      if (fromQuery) return fromQuery
    } catch {
      // ignore
    }
    const fromWindow = parseLevel(window.__XRK_LOG__)
    if (fromWindow) return fromWindow
    try {
      const fromStore = parseLevel(window.localStorage?.getItem('XRK_LOG'))
      if (fromStore) return fromStore
    } catch {
      // ignore
    }
  }
  return 'info'
}

function stamp(): string {
  return new Date().toISOString().slice(11, 23)
}

function ensureRing(): DiagGlobals {
  if (typeof window === 'undefined') {
    return { recent: [], level: 'info' }
  }
  let bag = window.__XRK_DIAG__
  if (bag === undefined) {
    bag = { recent: [], level: resolveLevel() }
    window.__XRK_DIAG__ = bag
  }
  return bag
}

function pushRing(record: DiagRecord): void {
  const bag = ensureRing()
  bag.recent.push(record)
  if (bag.recent.length > RING_CAP) bag.recent.splice(0, bag.recent.length - RING_CAP)
}

function formatDetail(detail: unknown): string {
  if (detail === undefined) return ''
  if (detail instanceof Error) {
    return detail.stack ?? detail.message
  }
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail, null, 2)
  } catch {
    return String(detail)
  }
}

/** Short user-facing line (no stack). */
export function shortError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function write(level: DiagLevel, ns: string, message: string, detail?: unknown): void {
  const bag = ensureRing()
  bag.level = resolveLevel()
  if (RANK[level] < RANK[bag.level]) return
  const ts = stamp()
  const line = `${ts} ${level.padEnd(5)}  ${ns}  ${message}`
  pushRing({ ts, level, ns, message, ...(detail !== undefined ? { detail } : {}) })
  const sink =
    level === 'error' ? console.error
      : level === 'warn' ? console.warn
        : level === 'debug' ? console.debug
          : console.info
  const useColor = typeof window !== 'undefined'
  if (useColor) {
    const levelColor =
      level === 'error' ? '#f85149'
        : level === 'warn' ? '#d29922'
          : level === 'debug' ? '#8b949e'
            : '#58a6ff'
    const head = `%c${ts}%c ${level.padEnd(5)}  %c${ns}%c  ${message}`
    const style = `color:#6e7681`
    const levelStyle = `color:${levelColor};font-weight:${level === 'error' ? '600' : '500'}`
    const nsStyle = `color:#a371f7`
    const msgStyle = `color:#c9d1d9`
    if (detail !== undefined && (level === 'warn' || level === 'error' || bag.level === 'debug')) {
      sink(head, style, levelStyle, nsStyle, msgStyle, detail)
    } else {
      sink(head, style, levelStyle, nsStyle, msgStyle)
    }
    return
  }
  if (detail !== undefined && (level === 'warn' || level === 'error' || bag.level === 'debug')) {
    sink(line, detail)
  } else if (detail !== undefined && bag.level === 'debug') {
    sink(line, formatDetail(detail))
  } else {
    sink(line)
  }
}

/** Scoped diagnostics logger. */
export function makeDiag(ns: string): Diag {
  return {
    ns,
    debug: (message, detail) => { write('debug', ns, message, detail) },
    info: (message, detail) => { write('info', ns, message, detail) },
    warn: (message, detail) => { write('warn', ns, message, detail) },
    error: (message, detail) => { write('error', ns, message, detail) },
    child: (scope) => makeDiag(ns ? `${ns}.${scope}` : scope),
  }
}

/** Default slot diagnostics channel. */
export const slotDiag = makeDiag('slot')
