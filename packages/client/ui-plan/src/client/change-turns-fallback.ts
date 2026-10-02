/**
 * Overview Falls back to conversation-timeline `workspace/changes` when Face
 * `workspaceChanges` is empty. Implementation lives in ui-primitives so
 * deliverables and plan share one fingerprint cache.
 */
export {
  harvestWorkspaceChangesTurns as harvestChangeTurns,
  stableWorkspaceChangesTurnsFromTimeline as changeTurnsFallbackSnapshot,
  EMPTY_WORKSPACE_CHANGES_TURNS as EMPTY_CHANGE_TURNS_FALLBACK,
  resetWorkspaceChangesTurnsCacheForTests,
} from '@xrkseek/client-ui-primitives'
