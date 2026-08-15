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
