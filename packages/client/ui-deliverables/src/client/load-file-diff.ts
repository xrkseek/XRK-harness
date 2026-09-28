import type { WorkspaceFileDiff } from '@xrkseek/xrk-api-remotes/client'

/** Face `changes.fileDiff` loader shared by card, hover, and overview review. */
export type LoadFileDiff = (
  seq: number,
  index: number,
  signal: AbortSignal,
) => Promise<WorkspaceFileDiff | null>
