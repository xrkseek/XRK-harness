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
     * Whole-log turn outline: every started turn with its turn/start Face seq
     * and bounded previews. Key absence means no outline (rail falls back to
     * the loaded window only).
     */
    turnOutline: readonly TurnOutlineEntry[]
  }
}

export {}
