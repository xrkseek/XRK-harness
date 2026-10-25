/**
 * SQLite `sessions.db` physical schema adjacent migrations (not Session Format V3).
 * Current = {@link SQLITE_SCHEMA_CURRENT} (= 3). Version 0 means unset / fresh.
 */

import {
  createAdjacentChain,
  type AdjacentChain,
  type AdjacentMigration,
} from "./chain.js";

/** Physical schema stamped in `meta.schema_version` (ADR-0009 ≠ Format V3). */
export const SQLITE_SCHEMA_CURRENT = 4;

/** Hooks the Host/store supplies so this package stays Cordis/sqlite-free. */
export interface SqliteSchemaMigrationHooks {
  /** Create `sessions` / `events` / indexes if missing. */
  ensureTables(): void;
  /** Create FTS index if missing. */
  ensureFts(): void;
  /** Rebuild FTS from events (schema bump path). */
  rebuildFts(): void;
  /** Add + backfill the `sessions` list-hint columns (v4). */
  ensureSessionHints(): void;
}

function edge(
  from: number,
  name: string,
  apply: (hooks: SqliteSchemaMigrationHooks) => void,
): AdjacentMigration<SqliteSchemaMigrationHooks> {
  return {
    name,
    fromVersion: from,
    toVersion: from + 1,
    apply,
  };
}

/**
 * Adjacent edges 0→1→2→3→4 for `sessions.db`.
 * - 0→1: base tables
 * - 1→2: FTS present
 * - 2→3: FTS rebuild (trigram / content sync)
 * - 3→4: `sessions` list-hint columns (last_ts / event_count / has_*)
 *
 * v4 exists because `session.list` used to run three per-session scans
 * (`MAX(ts)` plus two `json_extract` probes). Measured on a 205-session store
 * that was ≈7 s of cold list time; the columns make it one indexed read.
 */
export function createSqliteSchemaMigrations(): readonly AdjacentMigration<SqliteSchemaMigrationHooks>[] {
  return Object.freeze([
    edge(0, "sqlite-schema-v0-to-v1-tables", (h) => {
      h.ensureTables();
    }),
    edge(1, "sqlite-schema-v1-to-v2-fts", (h) => {
      h.ensureTables();
      h.ensureFts();
    }),
    edge(2, "sqlite-schema-v2-to-v3-fts-rebuild", (h) => {
      h.ensureTables();
      h.ensureFts();
      h.rebuildFts();
    }),
    edge(3, "sqlite-schema-v3-to-v4-session-hints", (h) => {
      h.ensureTables();
      h.ensureSessionHints();
    }),
  ]);
}

/** Compiled SQLite schema chain targeting {@link SQLITE_SCHEMA_CURRENT}. */
export function createSqliteSchemaChain(): AdjacentChain<SqliteSchemaMigrationHooks> {
  return createAdjacentChain({
    currentVersion: SQLITE_SCHEMA_CURRENT,
    migrations: createSqliteSchemaMigrations(),
  });
}

/**
 * Apply adjacent schema upgrades from `storedVersion` (0 = unset).
 * @returns {@link SQLITE_SCHEMA_CURRENT}
 */
export function migrateSqliteSchema(
  storedVersion: number,
  hooks: SqliteSchemaMigrationHooks,
): number {
  return createSqliteSchemaChain().migrate(storedVersion, hooks);
}
