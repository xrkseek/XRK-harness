/**
 * Boot splash hints — kernel-owned copy (locale plugins may not be ready yet).
 * Host wait stages match Desktop IPC (`starting` → `attaching` → `ready`);
 * long waits rotate tips by elapsed time inside the current wire phase.
 */

import type { LoaderStatus } from './loader-status.ts'

/** Splash language: product Settings `zh` / `en`, else Desktop / browser. */
export type BootLang = 'zh' | 'en'

/**
 * Desktop Host attach stages from main (spawn → composition → Fetch ready).
 * Same union as preload `__XRK_TRANSPORT__.getHostPhase` — no phantom stages.
 */
export type BootHostPhase = 'starting' | 'attaching' | 'ready'

/** Connection handshake / backoff phase labels used during product-ready wait. */
export type BootConnectionPhase =
  | 'handshake:host'
  | 'handshake:describe'
  | 'handshake:streams'
  | 'retry:backoff'

type BootHintKey =
  | 'plugins'
  | 'pluginsProgress'
  | 'connecting'
  | 'contacting'
  | 'streams'
  | 'sessions'
  | 'backoff'
  | 'failedTitle'

const EN: Record<BootHintKey, string> = {
  plugins: 'Summoning plugins…',
  pluginsProgress: 'Summoning plugins… {done}/{total}',
  connecting: 'Knocking on Face…',
  contacting: 'Asking Host who it is…',
  streams: 'Opening the event firehose…',
  sessions: 'Lining up your sessions…',
  backoff: 'Taking a breath, then retry…',
  failedTitle: 'Failed to load plugins',
}

const ZH: Record<BootHintKey, string> = {
  plugins: '正在召唤插件…',
  pluginsProgress: '正在召唤插件… {done}/{total}',
  connecting: '正在敲 Face 的门…',
  contacting: '正在问 Host 你是谁…',
  streams: '正在打开事件流…',
  sessions: '正在排队你的会话…',
  backoff: '歇一口气，马上再试…',
  failedTitle: '插件加载失败',
}

/** Fun rotating lines while Host is still coming up (index by elapsed bucket). */
const HOST_TIPS_EN: Record<Exclude<BootHostPhase, 'ready'>, readonly string[]> = {
  starting: [
    'Waking Host…',
    'Poking the Host process…',
    'Host, rise and shine…',
    'Brewing a fresh Host process…',
    'Knocking twice — Host usually answers…',
  ],
  // Spawn → IPC ready is one wire phase; tip ladder covers the long wait.
  attaching: [
    'Tucking Host into the shell…',
    'Threading the IPC pipes…',
    'Host is assembling the stack…',
    'Presets are lining up backstage…',
    'Warming the session engine…',
    'Teaching Face where the door is…',
    'Still cooking — almost savory…',
    'Host took the scenic route…',
    'Polishing the last bolt…',
    'Patience is a feature, not a bug…',
    'Almost — tying the shoelaces…',
    'One more breath, then showtime…',
  ],
}

const HOST_TIPS_ZH: Record<Exclude<BootHostPhase, 'ready'>, readonly string[]> = {
  starting: [
    '正在唤醒 Host…',
    '正在戳醒 Host 进程…',
    'Host，该起床了…',
    '正在现煮一份 Host…',
    '敲两下，Host 一般会开门…',
  ],
  attaching: [
    '正在把 Host 塞进壳里…',
    '正在打通 IPC 管道…',
    'Host 正在拼装内核…',
    '预设在后台排队入场…',
    '会话引擎预热中…',
    '正在教 Face 门在哪边…',
    '还在炖着，马上出锅…',
    'Host 走了条风景线…',
    '快好了，拧紧最后一颗螺丝…',
    '耐心也是一种功能…',
    '差一点点，在系鞋带…',
    '再吸一口气，就要开场了…',
  ],
}

/** Milliseconds per tip rotation within one Host phase. */
export const BOOT_HOST_TIP_INTERVAL_MS = 2_000

function dict(lang: BootLang): Record<BootHintKey, string> {
  return lang === 'zh' ? ZH : EN
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/gu, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key]! : match,
  )
}

function tipBucket(elapsedMs: number | undefined): number {
  if (elapsedMs === undefined || elapsedMs <= 0) return 0
  return Math.floor(elapsedMs / BOOT_HOST_TIP_INTERVAL_MS)
}

function pickHostTip(
  phase: Exclude<BootHostPhase, 'ready'>,
  lang: BootLang,
  elapsedMs: number | undefined,
): string {
  const pool = (lang === 'zh' ? HOST_TIPS_ZH : HOST_TIPS_EN)[phase]
  return pool[tipBucket(elapsedMs) % pool.length]!
}

/** Map a locale id / BCP-47 tag onto splash zh|en. */
export function bootLangFromTag(tag: string | undefined): BootLang | undefined {
  if (tag === undefined) return undefined
  const primary = tag.trim().toLowerCase().split('-')[0]
  if (primary === 'zh') return 'zh'
  if (primary === 'en') return 'en'
  return undefined
}

/**
 * Resolve splash language without the locale plugin.
 * Precedence: product Settings id → Desktop shell id → navigator → en.
 */
export function resolveBootLang(input: {
  readonly productLocaleId?: string
  readonly desktopLocaleId?: string
  readonly navigatorLanguages?: readonly string[]
} = {}): BootLang {
  const fromProduct = bootLangFromTag(input.productLocaleId)
  if (fromProduct !== undefined) return fromProduct
  const fromDesktop = bootLangFromTag(input.desktopLocaleId)
  if (fromDesktop !== undefined) return fromDesktop
  const tags = input.navigatorLanguages
    ?? (typeof navigator !== 'undefined'
      ? [...(navigator.languages ?? []), navigator.language]
      : [])
  for (const tag of tags) {
    const hit = bootLangFromTag(tag)
    if (hit !== undefined) return hit
  }
  return 'en'
}

/** Progressive plugin-tier hint from the loader status projection. */
export function bootPluginHint(status: LoaderStatus, lang: BootLang = 'en'): string {
  const copy = dict(lang)
  const ids = Object.keys(status)
  if (ids.length === 0) return copy.plugins
  let done = 0
  for (const id of ids) {
    const state = status[id]
    if (state === 'active' || state === 'failed') done += 1
  }
  return fill(copy.pluginsProgress, {
    done: String(done),
    total: String(ids.length),
  })
}

/**
 * Hint while Desktop Host is still coming up (spawn → composition → wire).
 * Pass `elapsedMs` so long waits rotate tips inside the same IPC phase.
 */
export function bootHostPhaseHint(
  phase: BootHostPhase | undefined,
  lang: BootLang = 'en',
  options: { readonly elapsedMs?: number } = {},
): string {
  const copy = dict(lang)
  switch (phase) {
    case 'attaching':
      return pickHostTip('attaching', lang, options.elapsedMs)
    case 'ready':
      return copy.connecting
    case 'starting':
    default:
      return pickHostTip('starting', lang, options.elapsedMs)
  }
}

/**
 * Hint for one Face connection handshake phase.
 * After Host Fetch is attached, never reuse the host-starting label.
 */
export function bootConnectionHint(
  phase: BootConnectionPhase | undefined,
  options: { readonly hostAttached?: boolean; readonly lang?: BootLang } = {},
): string {
  const copy = dict(options.lang ?? 'en')
  switch (phase) {
    case 'handshake:host':
      return options.hostAttached === true
        ? copy.connecting
        : pickHostTip('starting', options.lang ?? 'en', undefined)
    case 'handshake:describe':
      return copy.contacting
    case 'handshake:streams':
      return copy.streams
    case 'retry:backoff':
      return copy.backoff
    default:
      return copy.connecting
  }
}

/** Sessions-list wait hint. */
export function bootSessionsHint(lang: BootLang = 'en'): string {
  return dict(lang).sessions
}

/** Fail-loud title on the splash (AppRoot). */
export function bootFailedTitle(lang: BootLang = 'en'): string {
  return dict(lang).failedTitle
}
