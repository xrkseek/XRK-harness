/**
 * Build-static catalog of XRK session format seams (interop ≠ Format V3).
 */

import { SESSION_INTERCHANGE_VERSION } from "./interchange-version.js";
import { SQLITE_SCHEMA_CURRENT } from "./sqlite-schema.js";

/** Named durable seams this repo owns. */
export const SESSION_FORMAT_SEAMS = Object.freeze({
  /** Role JSONL ↔ XRK events. Not written to `sessions.db`. */
  interchange: Object.freeze({
    id: "xrk-interchange" as const,
    currentVersion: SESSION_INTERCHANGE_VERSION,
  }),
  /** Physical `sessions.db` schema (ADR-0009). */
  sqliteSchema: Object.freeze({
    id: "xrk-sqlite-schema" as const,
    currentVersion: SQLITE_SCHEMA_CURRENT,
  }),
  /** Export sidecar: packed chunk rows + optional zstd. */
  packedJsonl: Object.freeze({
    id: "xrk-packed-jsonl" as const,
  }),
});

/**
 * Explicit product stance: third-party Session Format V3 is **not** a seam.
 * @see docs/adr/0009-session-format-v3-vs-sqlite-schema-v3.md
 */
export const SESSION_FORMAT_V3_ADOPTED = false as const;

export function sessionFormatCatalogSummary(): string {
  return [
    `${SESSION_FORMAT_SEAMS.interchange.id}@v${SESSION_FORMAT_SEAMS.interchange.currentVersion}`,
    `${SESSION_FORMAT_SEAMS.sqliteSchema.id}@v${SESSION_FORMAT_SEAMS.sqliteSchema.currentVersion}`,
    SESSION_FORMAT_SEAMS.packedJsonl.id,
    `session-format-v3:adopted=${SESSION_FORMAT_V3_ADOPTED}`,
  ].join(" · ");
}
