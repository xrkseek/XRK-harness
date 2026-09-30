/**
 * Re-export Face fileDiff → DiffHunk transform (canonical impl in ui-primitives
 * so Overview Changes and the turn-tail card share one implementation).
 */
export { diffHunkFromWorkspaceFileDiff } from '@xrkseek/client-ui-primitives'
export type { DiffHunk as DiffHunkTexts } from '@xrkseek/client-ui-primitives'
