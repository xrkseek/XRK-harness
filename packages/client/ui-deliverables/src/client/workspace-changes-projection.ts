/**
 * Client-side merge of Face `workspaceChanges` into SessionProjectionMap.
 *
 * The authoritative declare lives on `@xrkseek/xrk-host-apiproxy` sessions
 * contract; importing that emitted .d.ts does not land the merge for this
 * package's tsc emit. Mirror the key here (same shape) so Overview /
 * useProjection('workspaceChanges') is typed.
 */
import type { WorkspaceChangesProjected } from '@xrkseek/xrk-host-apiproxy/api'

declare module '@xrkseek/xrk-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * Per-turn changed-files summaries (Overview `#改动` / deliverables).
     * Each row carries Face `seq` for `changes.fileDiff`.
     */
    workspaceChanges: readonly WorkspaceChangesProjected[]
  }
}

export {}
