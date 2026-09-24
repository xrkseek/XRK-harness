/**
 * `@xrkseek/session-format` — adjacent migration chain + artifact detect.
 *
 * Product stance (ADR-0009): cross-product **interchange** and SQLite schema
 * upgrades are first-class; third-party **Session Format V3** is not adopted.
 */

export {
  SessionFormatError,
  SessionFormatUnsupportedMigrationError,
  defineAdjacentMigration,
  createAdjacentChain,
  type AdjacentMigration,
  type AdjacentChain,
  type AdjacentChainOptions,
} from "./chain.js";

export {
  detectSessionArtifact,
  type SessionArtifactKind,
} from "./detect.js";

export {
  SQLITE_SCHEMA_CURRENT,
  createSqliteSchemaMigrations,
  createSqliteSchemaChain,
  migrateSqliteSchema,
  type SqliteSchemaMigrationHooks,
} from "./sqlite-schema.js";

export {
  SESSION_FORMAT_SEAMS,
  SESSION_FORMAT_V3_ADOPTED,
  sessionFormatCatalogSummary,
} from "./catalog.js";

export { SESSION_INTERCHANGE_VERSION } from "./interchange-version.js";
