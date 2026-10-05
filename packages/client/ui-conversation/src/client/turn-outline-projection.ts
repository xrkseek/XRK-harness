/**
 * Client-side merge of Face `turnOutline` into SessionProjectionMap.
 *
 * The authoritative declare lives on `@xrkseek/xrk-host-apiproxy` sessions
 * contract; importing that emitted .d.ts does not land the merge for this
 * package's tsc emit. Mirror the key here (same shape) so ChatView's
 * useProjection('turnOutline') is typed.
 */
import type { TurnOutlineEntry } from '@xrkseek/xrk-host-apiproxy/api'

declare module '@xrkseek/xrk-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * Whole-log 轮次 outline: Host turns that already have a human opener,
     * with turn/start Face seq, gapless `round`, and bounded previews.
     */
    turnOutline: readonly TurnOutlineEntry[]
  }
}

export {}
