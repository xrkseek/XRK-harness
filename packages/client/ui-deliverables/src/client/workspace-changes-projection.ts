/**
 * Client-side merge of Face `workspaceChanges` into SessionProjectionMap.
 * Authoritative fold lives on Face; this types `useProjection('workspaceChanges')`.
 */

declare module '@xrkseek/xrk-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * Turn-end changed-files summaries (DSH workspace/changes).
     * Each row carries Face `seq` for `changes.fileDiff`.
     */
    workspaceChanges: readonly {
      readonly turnId: string
      readonly cwd: string
      readonly seq: number
      readonly files: readonly {
        readonly path: string
        readonly display: string
        readonly added: number
        readonly deleted: number
        readonly binary?: true
        readonly oversized?: true
      }[]
      readonly total: number
      readonly added: number
      readonly deleted: number
      readonly snapshot?: { readonly before: string; readonly after: string }
    }[]
  }
}
