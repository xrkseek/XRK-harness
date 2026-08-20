export {
  createFaceProjectionRegistry,
  type FaceProjectionMap,
  type FaceProjectionRegistry,
  type FaceProjectionRegistryOptions,
  type ProjectionChangeListener,
  type ProjectionCheckpoint,
  type ProjectionCheckpointRow,
  type ProjectionDefinition,
  type ProjectionSnapshot,
  type SessionListMetadata,
} from "./registry.js";
export {
  createTitleProjectionUnit,
  type TitleProjectionState,
} from "./units/title.js";
export { createSessionListMetadataUnit } from "./units/session-list-metadata.js";
export { createTodosProjectionUnit } from "./units/todos.js";
export { createPermissionsProjectionUnit } from "./units/permissions.js";
export { createPlanProjectionUnit } from "./units/plan.js";
export { createImageLimitsProjectionUnit } from "./units/image-limits.js";
export {
  createSessionStatsProjectionUnit,
  type SessionStatsProjection,
} from "./units/session-stats.js";
export {
  createTokenUsageProjectionUnit,
  type TokenUsageProjection,
} from "./units/token-usage.js";
export {
  createContextPressureProjectionUnit,
  type ContextPressureProjection,
} from "./units/context-pressure.js";
export {
  createContextBreakdownProjectionUnit,
  type ContextBreakdownProjection,
} from "./units/context-breakdown.js";
export {
  DEFAULT_FALLBACK_MAX_WORDS,
  DEFAULT_TITLE_MAX_BYTES,
  fallbackSessionTitle,
  normalizeSessionTitle,
  truncateTitleUtf8,
} from "./title-normalize.js";
export {
  FaceTitleController,
  SessionTitleInvalidError,
  type TitleControllerOptions,
} from "./title-controller.js";
export { installDefaultFaceProjections } from "./install-defaults.js";
