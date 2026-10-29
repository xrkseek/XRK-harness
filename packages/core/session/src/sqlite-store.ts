import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  assertSessionEvent,
  SessionEventParseError,
} from "@xrkseek/protocol";
import {
  expandPackedStorageRecords,
  isPackedChunkRow,
  isTextChunkRow,
  isToolCallChunkRow,
  packChunkRunsForExport,
  type PackedStorageRecord,
} from "./chunk-pack.js";
import { freezeSessionEvent, newSessionId } from "./freeze.js";
import {
  repairOpenTurnEvents,
  sessionHasOpenTurn,
} from "./repair-open-turn.js";
import { extractEventSearchText } from "./search-text.js";
import { snapshotEvents } from "./seq.js";
import { computeListHints } from "./list-hints.js";
import type { SessionRecord, SessionListHints, SessionStore } from "./store.js";
import {
  acquireSessionsDirLock,
  type SessionsDirLock,
} from "./store-lock.js";
import {
  migrateSqliteSchema,
  SQLITE_SCHEMA_CURRENT,
} from "@xrkseek/session-format";
import { resolveSqliteJournalMode } from "./sqlite-journal.js";

export {
  acquireSessionsDirLock,
  SessionsDirInUseError,
  SESSIONS_WRITE_LOCK_FILENAME,
  type SessionsDirLock,
} from "./store-lock.js";
export {
  isLikelyRemoteSessionsPath,
  resolveSqliteJournalMode,
  type SqliteJournalMode,
} from "./sqlite-journal.js";

function openDatabase(dbPath: string, readOnly = false): DatabaseSync {
  const { DatabaseSync: Db } = process.getBuiltinModule(
    "node:sqlite",
  );
  return readOnly ? new Db(dbPath, { readOnly: true }) : new Db(dbPath);
}

export interface PersistentSessionStore extends SessionStore {
  /**
   * Flush batched writes. No argument drains every session (close / search /
   * eviction). A session id commits only that session's pending batch.
   */
  flush(sessionId?: string): void;
  /** Release the database handle (required on Windows before deleting the file). */
  close(): void;
  /**
   * FTS5 (trigram) candidate session ids for `session.search`.
   * Empty when no searchable hit; Face still builds snippets from events.
   */
  searchSessionIds(query: string): readonly string[];
  /**
   * Live event log without defensive copy (projection / internal reads).
   * Throws when session is not resident — call after {@link get}, {@link append},
   * or {@link readEvents}.
   */
  eventsRef(id: string): readonly SessionEvent[];
  /**
   * Called immediately before an in-memory session log is dropped (LRU).
   * The session is still resident during the callback so `eventsRef` works;
   * Face writes list-tier checkpoints here, then clears projection cells.
   */
  bindSessionEviction(handler: (sessionId: string) => void): void;
  /**
   * Drop one idle session from the resident set (cold history / search).
   * Flushes pending writes and notifies {@link bindSessionEviction} first.
   * Refuses (returns false) while a turn is still open.
   */
  releaseResident(sessionId: string): boolean;
  /**
   * Background microtask flush failures (DSH-style loud drain pause).
   * Cleared after a successful explicit {@link flush}.
   */
  flushFailureReport(): {
    readonly failures: number;
    readonly paused: boolean;
    readonly lastError?: string;
  };
  /**
   * VACUUM when freelist is meaningful after deletes or archive offload.
   */
  reclaimStorage(): boolean;
  /**
   * Move one session's durable rows from {@link SESSION_DB_FILENAME} into
   * {@link SESSION_ARCHIVE_DB_FILENAME}. Idempotent when already offloaded.
   * Reads (`get` / `list` / search) still see the id; mutates (`append`) throw.
   */
  offloadToArchive(id: string): void;
  /**
   * Move one offloaded session back into the hot DB. Idempotent when already hot.
   */
  restoreFromArchive(id: string): void;
  /** True when the durable log sits in the archive DB (not the hot file). */
  isOffloaded(id: string): boolean;
}

export interface PersistentSessionStoreOptions {
  /**
   * Soft cap on sessions kept resident in memory (default 8).
   * Sessions with an open turn are never evicted; the resident set may
   * temporarily exceed this cap while many turns are in flight.
   */
  readonly maxResidentSessions?: number;
  /**
   * When true, skip the exclusive write lease and open the DB read-only
   * (inspect / secondary readers). Mutating APIs throw. Host and CLI writers
   * must omit this so a second Host fails closed instead of silently sharing
   * `sessions.db`.
   */
  readonly shared?: boolean;
  /**
   * WAL size (bytes) above which an idle flush may run a TRUNCATE checkpoint
   * to give the disk space back. Default 64 MiB; tests lower it so they do not
   * have to write 64 MiB to observe the shrink.
   */
  readonly walShrinkMinBytes?: number;
  /**
   * Minimum spacing between WAL shrink attempts (default 60 s). Tests pass 0 so
   * a single `flush()` can observe the reclaim.
   */
  readonly walShrinkIntervalMs?: number;
}

const ID_RE = /^[A-Za-z0-9._-]+$/;
/** Diagnostic switch: print why an idle WAL reclaim was skipped. */
const DEBUG_WAL_CHECKPOINT = Boolean(process.env.XRK_DEBUG_WAL);
/** Physical schema v3: durable rows may be packed chunk rows (expanded on load). */
const SCHEMA_VERSION = SQLITE_SCHEMA_CURRENT;

/**
 * Consecutive searches that had to fall back because the FTS index could not
 * be read. Only used to throttle the diagnostic line.
 */
let searchIndexFailures = 0;
const DB_NAME = "sessions.db";
/** Cold sibling of {@link DB_NAME}: archived session logs live here. */
const ARCHIVE_DB_NAME = "sessions-archive.db";
const DEFAULT_MAX_RESIDENT_SESSIONS = 8;
/**
 * Reclaim freelist when it is both large and a big share of the file (deleted
 * sessions leave empty pages that still cost mmap / Working Set). Skip small
 * DBs and shared readers. Used on exclusive `close()` and after Face deletes.
 */
const VACUUM_MIN_FREE_BYTES = 64 * 1024 * 1024;
const VACUUM_MIN_FREE_RATIO = 0.2;
/** Explicit reclaim after delete / archive offload: lower bar so bulk ops shrink sooner. */
const VACUUM_EXPLICIT_MIN_FREE_BYTES = 16 * 1024 * 1024;
const VACUUM_EXPLICIT_MIN_FREE_RATIO = 0.1;

function deleteSessionRows(db: DatabaseSync, id: string): void {
  db.prepare("DELETE FROM search_fts WHERE session_id = ?").run(id);
  db.prepare("DELETE FROM events WHERE session_id = ?").run(id);
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

/**
 * Run `fn` inside one `BEGIN IMMEDIATE … COMMIT`, rolling back on throw.
 *
 * The three deletes above are a single logical removal: they used to autocommit
 * one by one, so a crash (or a locked FTS index) between them left "skull" rows
 * — `events` gone while `search_fts` still matched, so search returned a
 * sessionId that `has()` reports as missing. Callers that already hold a
 * transaction (`copySessionRows`) must not wrap again.
 */
function withImmediate(db: DatabaseSync, run: () => void): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    run();
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already rolled back / connection gone */
    }
    throw err;
  }
}

/** Copy one session's sessions/events/FTS rows from `from` into `to` (replace). */
function copySessionRows(
  from: DatabaseSync,
  to: DatabaseSync,
  id: string,
): void {
  const eventRows = from
    .prepare(
      "SELECT seq, ts, payload FROM events WHERE session_id = ? ORDER BY seq ASC",
    )
    .all(id) as { seq: number; ts: number; payload: string }[];
  const ftsRows = from
    .prepare("SELECT seq, text FROM search_fts WHERE session_id = ?")
    .all(id) as { seq: number; text: string }[];
  // Hints travel with the rows. Inserting a bare `id` left every archived or
  // restored session at event_count/last_ts 0 forever (the backfill only runs
  // on a schema bump), which made `session.list` fall back to a full event scan
  // and reported the session as blank. A missing row stays 0 on purpose: the
  // hint reader treats <= 0 as "unknown" and rescans correctly.
  const hints = from
    .prepare(
      "SELECT last_ts, event_count, has_turn_start, has_command_run FROM sessions WHERE id = ?",
    )
    .get(id) as {
    last_ts: number;
    event_count: number;
    has_turn_start: number;
    has_command_run: number;
  } | undefined;
  to.exec("BEGIN IMMEDIATE");
  try {
    deleteSessionRows(to, id);
    to.prepare(
      "INSERT INTO sessions (id, last_ts, event_count, has_turn_start, has_command_run) VALUES (?, ?, ?, ?, ?)",
    ).run(
      id,
      hints?.last_ts ?? 0,
      hints?.event_count ?? 0,
      hints?.has_turn_start ?? 0,
      hints?.has_command_run ?? 0,
    );
    // One prepared statement reused per row beats chunked multi-value INSERTs
    // here: measured on an 18,370-row / 45.8 MB session, batching made
    // offload/restore ~25% *slower* (2,744 / 2,726 ms vs 2,197 / 2,116 ms),
    // because every chunk needs a fresh `prepare` and SQLite's per-row path
    // already reuses the compiled statement.
    const insertEvent = to.prepare(
      "INSERT INTO events (session_id, seq, ts, payload) VALUES (?, ?, ?, ?)",
    );
    for (const row of eventRows) {
      insertEvent.run(id, row.seq, row.ts, row.payload);
    }
    const insertFts = to.prepare(
      "INSERT INTO search_fts (session_id, seq, text) VALUES (?, ?, ?)",
    );
    for (const row of ftsRows) {
      insertFts.run(id, row.seq, row.text);
    }
    to.exec("COMMIT");
  } catch (err) {
    try {
      to.exec("ROLLBACK");
    } catch {
      /* already rolled back / closed */
    }
    throw err;
  }
}

function maybeVacuum(
  db: DatabaseSync,
  options: {
    readonly minFreeBytes: number;
    readonly minFreeRatio: number;
  },
): boolean {
  try {
    const pageSize = Number(
      (db.prepare("PRAGMA page_size").get() as { page_size: number }).page_size,
    );
    const pageCount = Number(
      (db.prepare("PRAGMA page_count").get() as { page_count: number })
        .page_count,
    );
    const freelist = Number(
      (db.prepare("PRAGMA freelist_count").get() as { freelist_count: number })
        .freelist_count,
    );
    if (
      !Number.isFinite(pageSize) ||
      !Number.isFinite(pageCount) ||
      !Number.isFinite(freelist) ||
      pageCount <= 0
    ) {
      return false;
    }
    const freeBytes = freelist * pageSize;
    if (
      freeBytes < options.minFreeBytes ||
      freelist / pageCount < options.minFreeRatio
    ) {
      return false;
    }
    db.exec("VACUUM");
    return true;
  } catch {
    /* best-effort: never fail Host / Face on vacuum */
    return false;
  }
}

interface PendingEvent {
  readonly sessionId: string;
  readonly event: SessionEvent;
}

/**
 * Non-chunk events accumulate in `pending` until one of these forces a flush:
 * - a durability boundary event arrives (`user/message`, `turn/*`,
 *   `command/*`, `prompt/*` — user inputs / lifecycle edges that must not
 *   be lost on crash; crash repair relies on them to close open turns),
 * - that session's own pending count crosses this ceiling (model-output
 *   bursts inside one very long turn), or
 * - an explicit no-arg `flush()` (close / whole-DB vacuum). Drain idle,
 *   eviction, delete, archive, and replacePrefix pass a session id.
 *   Search matches `pending` in memory and does not flush.
 * Automatic flushes write only the session that tripped them. Another
 * session's interior batch stays in memory until its own boundary, its own
 * ceiling, or an explicit `flush()`.
 * Model-interior events (`assistant/*`, `step/*`, `tool/*`, `llm/*`) batch:
 * a crash loses at most this window of model output, and
 * `repairOpenTurnEvents` still closes the turn on reload. Durability
 * boundaries (`user/message`, `turn/*`, `prompt/*`, `command/*`) still flush
 * before the next macrotask via `queueMicrotask` so Face can mux-publish in
 * the same turn without waiting on sqlite COMMIT (idle/close still `flush()`).
 */
const MICRO_BATCH_MAX_PENDING = 64;

function assertSafeId(id: string): string {
  if (!ID_RE.test(id)) {
    throw new Error(`unsafe session id for sqlite store: ${id}`);
  }
  return id;
}

  /** Escape a user query for FTS5 MATCH (trigram substring). */
  export function ftsMatchQuery(query: string): string {
    const trimmed = query.trim();
    if (!trimmed) return '""';
    return `"${trimmed.replace(/"/g, '""')}"`;
  }

  /**
   * How one user query should reach `search_fts`.
   *
   * The `trigram` tokenizer only indexes runs of three or more code points, so
   * a shorter needle can never match — SQLite's rule is "substrings consisting
   * of fewer than 3 unicode characters do not match any rows when used with a
   * full-text query". Chinese two-character words ("部署", "修复", "测试") and
   * short acronyms ("AI", "PR") are exactly that shape, and MATCHing them
   * returned nothing while thousands of matching rows sat in the index. Short
   * needles therefore take the LIKE scan (`text` is UNINDEXED, so this is a
   * plain column scan bounded by the DISTINCT id projection).
   */
  export type FtsQueryPlan =
    | { readonly kind: "match"; readonly value: string }
    | { readonly kind: "like"; readonly value: string }
    | null;

  export function planFtsQuery(query: string): FtsQueryPlan {
    const trimmed = query.trim();
    if (!trimmed) return null;
    // Code points, not UTF-16 units: the tokenizer counts characters.
    if ([...trimmed].length >= 3) {
      return { kind: "match", value: ftsMatchQuery(trimmed) };
    }
    return {
      kind: "like",
      value: `%${trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
    };
  }

/**
 * Join text chunks so a token split across indexes stays searchable after flush.
 * `prefix` is the nearest earlier text chunk before this batch (flush boundary).
 * Non-text events between the two chunks are skipped.
 */
function textChunkSearchJoin(
  events: readonly SessionEvent[],
  prefix = "",
): string | null {
  let parts = prefix ? 1 : 0;
  let text = prefix;
  for (const event of events) {
    if (
      event.type === "assistant/chunk"
      && event.kind === "text"
      && event.text
    ) {
      parts += 1;
      text += event.text;
    }
  }
  if (parts < 2) return null;
  return text;
}

function previousTextChunk(
  events: readonly SessionEvent[],
  first: SessionEvent,
): string {
  const idx = events.indexOf(first);
  for (let i = idx - 1; i >= 0; i -= 1) {
    const prev = events[i]!;
    if (
      prev.type === "assistant/chunk"
      && prev.kind === "text"
      && typeof prev.text === "string"
      && prev.text
    ) {
      return prev.text;
    }
  }
  return "";
}

function extractStorageSearchText(record: PackedStorageRecord): string | null {
  if (isTextChunkRow(record)) {
    const text = record.texts.join("");
    return text || null;
  }
  if (isToolCallChunkRow(record)) {
    // Argument fragments are not model-visible search text.
    return null;
  }
  return extractEventSearchText(record) || null;
}

function storageTs(record: PackedStorageRecord): number {
  return isPackedChunkRow(record) ? record.ts0 : record.ts;
}

function ensureFts(db: DatabaseSync): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
      session_id UNINDEXED,
      seq UNINDEXED,
      text,
      tokenize = 'trigram'
    );
  `);
}

function schemaVersion(db: DatabaseSync): number {
  const row = db
    .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  return row ? Number(row.value) || 0 : 0;
}

/**
 * Cheap self-heal probe for the current-schema fast path.
 *
 * `schema_version` alone is not proof the objects survive — a hand-edited or
 * partially restored DB can carry the version with `events` dropped. This
 * reads `sqlite_master` (an in-memory catalog lookup, no page scan, no write
 * lock) so the fast path still repairs a broken store instead of failing later
 * inside a prepared INSERT.
 */
function schemaObjectsPresent(db: DatabaseSync): boolean {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('events', 'sessions', 'search_fts')",
    )
    .get() as { n: number } | undefined;
  return (row?.n ?? 0) >= 3;
}

/** v4: add the list-hint columns to a pre-existing `sessions` table. */
function addSessionHintColumns(db: DatabaseSync): void {
  const cols = new Set(
    (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );
  const additions: readonly (readonly [string, string])[] = [
    ["last_ts", "ALTER TABLE sessions ADD COLUMN last_ts INTEGER NOT NULL DEFAULT 0"],
    ["event_count", "ALTER TABLE sessions ADD COLUMN event_count INTEGER NOT NULL DEFAULT 0"],
    ["has_turn_start", "ALTER TABLE sessions ADD COLUMN has_turn_start INTEGER NOT NULL DEFAULT 0"],
    ["has_command_run", "ALTER TABLE sessions ADD COLUMN has_command_run INTEGER NOT NULL DEFAULT 0"],
  ];
  for (const [name, ddl] of additions) {
    if (!cols.has(name)) db.exec(ddl);
  }
}

/**
 * v4 backfill: one pass over `events` fills every session's hint columns.
 *
 * The old cold `session.list` path ran three scans **per session** (`MAX(ts)`
 * plus two `json_extract` probes). On the 205-session store that measured
 * ≈7 s; this is a single grouped scan paid once at migration time.
 */
function backfillSessionHints(db: DatabaseSync): void {
  db.exec("INSERT OR IGNORE INTO sessions (id) SELECT DISTINCT session_id FROM events");
  db.exec("DROP TABLE IF EXISTS temp._session_hint_agg");
  db.exec(`
    CREATE TEMP TABLE _session_hint_agg AS
    SELECT session_id,
           MAX(ts) AS last_ts,
           COUNT(*) AS event_count,
           MAX(CASE WHEN json_extract(payload, '$.type') = 'turn/start' THEN 1 ELSE 0 END) AS has_turn_start,
           MAX(CASE WHEN json_extract(payload, '$.type') = 'command/run' THEN 1 ELSE 0 END) AS has_command_run
    FROM events
    GROUP BY session_id
  `);
  db.exec(`
    UPDATE sessions SET
      last_ts = a.last_ts,
      event_count = a.event_count,
      has_turn_start = a.has_turn_start,
      has_command_run = a.has_command_run
    FROM _session_hint_agg a
    WHERE a.session_id = sessions.id
  `);
  db.exec("DROP TABLE temp._session_hint_agg");
}

function setSchemaVersion(db: DatabaseSync, version: number): void {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(String(version));
}

function rebuildFts(db: DatabaseSync): void {
  db.exec("DELETE FROM search_fts");
  const insert = db.prepare(
    "INSERT INTO search_fts (session_id, seq, text) VALUES (?, ?, ?)",
  );
  const rows = db
    .prepare("SELECT session_id, seq, payload FROM events ORDER BY session_id, seq")
    .all() as { session_id: string; seq: number; payload: string }[];
  for (const row of rows) {
    try {
      const raw: unknown = JSON.parse(row.payload);
      if (isPackedChunkRow(raw)) {
        const text = extractStorageSearchText(raw);
        if (text) insert.run(row.session_id, row.seq, text);
        continue;
      }
      const event = assertSessionEvent(raw);
      const text = extractEventSearchText(event);
      if (text) insert.run(row.session_id, row.seq, text);
    } catch {
      /* skip corrupt */
    }
  }
}

function initSchema(db: DatabaseSync, journalMode: "WAL" | "DELETE" = "WAL"): void {
  db.exec(`PRAGMA journal_mode = ${journalMode}`);
  // WAL + FULL fsyncs on every commit, and a turn has at least four durability
  // boundaries. NORMAL keeps crash safety at transaction granularity (only the
  // last commit can be lost) and `repairOpenTurnEvents` already settles open
  // turns. `user/message` still upgrades to FULL around its own transaction in
  // `flushPending`, so a queued human message is never the one that is lost.
  db.exec(
    journalMode === "WAL"
      ? "PRAGMA synchronous = NORMAL"
      : "PRAGMA synchronous = FULL",
  );
  if (journalMode === "WAL") {
    // Without these the WAL only ever grows: a long reader blocks the implicit
    // autocheckpoint and nothing else reclaims the file (seen at 535 MB).
    db.exec("PRAGMA wal_autocheckpoint = 1000");
    db.exec("PRAGMA journal_size_limit = 67108864");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const hooks = {
    ensureTables: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          last_ts INTEGER NOT NULL DEFAULT 0,
          event_count INTEGER NOT NULL DEFAULT 0,
          has_turn_start INTEGER NOT NULL DEFAULT 0,
          has_command_run INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS events (
          session_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          ts INTEGER NOT NULL,
          payload TEXT NOT NULL,
          PRIMARY KEY (session_id, seq),
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        );
        CREATE INDEX IF NOT EXISTS idx_events_session_seq
          ON events (session_id, seq);
      `);
    },
    ensureSessionHints: () => {
      addSessionHintColumns(db);
      backfillSessionHints(db);
    },
    ensureFts: () => {
      ensureFts(db);
    },
    rebuildFts: () => {
      ensureFts(db);
      rebuildFts(db);
    },
  };

  const stored = schemaVersion(db);
  if (stored > SCHEMA_VERSION) {
    // Direction-aware refusal. A newer build already migrated this file and may
    // have written rows this build would misread; opening it "successfully"
    // would rewrite that data under the old shape — silent corruption instead
    // of a message the user can act on.
    throw new Error(
      `sessions.db schema v${stored} is newer than this build (v${SCHEMA_VERSION}):`
      + " it was written by a newer XRK Harness — upgrade instead of opening it",
    );
  }
  if (stored >= SCHEMA_VERSION) {
    // A current schema_version means the migration chain already built every
    // table/index/FTS object. Re-running the full DDL on every Host start takes
    // the write lock on a multi-hundred-MB file for nothing, so only verify
    // (cheap sqlite_master lookup) and repair when something is actually gone.
    if (process.env.XRK_SQLITE_VERIFY_SCHEMA === "1" || !schemaObjectsPresent(db)) {
      hooks.ensureTables();
      hooks.ensureFts();
    }
    return;
  }
  const next = migrateSqliteSchema(stored, hooks);
  setSchemaVersion(db, next);
}

function parseStoragePayload(payload: string): SessionEvent[] {
  const raw: unknown = JSON.parse(payload);
  if (isPackedChunkRow(raw)) {
    return expandPackedStorageRecords([raw]);
  }
  return [assertSessionEvent(raw)];
}

/** True when `prefix` is `full[0..prefix.length)` (JSON-stable event equality). */
function logicalEventsEqualPrefix(
  full: readonly SessionEvent[],
  prefix: readonly SessionEvent[],
): boolean {
  if (prefix.length > full.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    // Truncate / edit-resubmit usually passes a `slice` of the resident log —
    // same object identity. JSON.stringify of 16k events was dominating the
    // R7 fast path (~hundreds of ms) before the cheap DELETE.
    if (full[i] === prefix[i]) continue;
    if (JSON.stringify(full[i]) !== JSON.stringify(prefix[i])) return false;
  }
  return true;
}

/**
 * Map a logical keep-count onto the first *physical* `events.seq` to delete.
 * Packed chunk rows that straddle the cut force a full rewrite.
 *
 * When `totalLogical` is known (resident length / healed hints), walk **DESC**
 * and only expand the discarded suffix — edit-resubmit / truncate usually drop
 * a few hundred events off a multi-10k log; ASC-scanning the whole prefix was
 * the R7 fast-path bottleneck (~1–2 s).
 */
function physicalTailCutSeq(
  db: DatabaseSync,
  sessionId: string,
  keepLogical: number,
  totalLogical?: number,
): number | "empty" | "noop" | "rewrite" {
  if (keepLogical <= 0) return "empty";
  if (
    typeof totalLogical === "number"
    && totalLogical >= keepLogical
    && Number.isFinite(totalLogical)
  ) {
    const needDrop = totalLogical - keepLogical;
    if (needDrop === 0) return "noop";
    const iter = db
      .prepare(
        "SELECT seq, payload FROM events WHERE session_id = ? ORDER BY seq DESC",
      )
      .iterate(sessionId) as IterableIterator<{ seq: number; payload: string }>;
    let dropped = 0;
    let sawRow = false;
    for (const row of iter) {
      sawRow = true;
      let n: number;
      try {
        n = parseStoragePayload(row.payload).length;
      } catch {
        return "rewrite";
      }
      if (dropped + n < needDrop) {
        dropped += n;
        continue;
      }
      if (dropped + n === needDrop) {
        return row.seq;
      }
      // Packed row straddles the logical cut.
      return "rewrite";
    }
    if (!sawRow) return "noop";
    return "rewrite";
  }

  const rows = db
    .prepare(
      "SELECT seq, payload FROM events WHERE session_id = ? ORDER BY seq ASC",
    )
    .all(sessionId) as { seq: number; payload: string }[];
  if (rows.length === 0) return "noop";
  let logical = 0;
  for (const row of rows) {
    if (logical >= keepLogical) return row.seq;
    let n: number;
    try {
      n = parseStoragePayload(row.payload).length;
    } catch {
      return "rewrite";
    }
    if (logical + n <= keepLogical) {
      logical += n;
      continue;
    }
    return "rewrite";
  }
  return logical === keepLogical ? "noop" : "rewrite";
}

/**
 * A stored row this build cannot read: corrupt JSON, an unknown event type, or
 * a row written by a newer format.
 *
 * Loading stops here instead of returning the rows that happened to work,
 * because `ensureLoaded` feeds whatever it gets straight into crash repair: a
 * silently truncated view makes the store append a synthetic `turn/end` into
 * the real log, which pushes every surviving event behind a turn boundary that
 * never existed. Refusing to load is the only failure that leaves the log
 * intact, so the caller can tell the user to upgrade instead.
 */
export class SessionLogUnreadableError extends Error {
  constructor(
    readonly sessionId: string,
    /** Position of the first unreadable row. */
    readonly seq: number,
    readonly reason: string,
  ) {
    super(
      `session log unreadable: ${sessionId} seq ${seq} (${reason}) — refusing to load a partial log`,
    );
    this.name = "SessionLogUnreadableError";
  }
}

function loadSessionEvents(db: DatabaseSync, id: string): SessionEvent[] {
  const rows = db
    .prepare("SELECT seq, payload FROM events WHERE session_id = ? ORDER BY seq ASC")
    .all(id) as { seq: number; payload: string }[];
  const events: SessionEvent[] = [];
  for (const row of rows) {
    try {
      events.push(...parseStoragePayload(row.payload));
    } catch (error) {
      // Newer Harness may write pure-info rows with `ignorable: true`. Skipping
      // keeps the readable prefix intact; required unknowns still refuse load.
      if (
        error instanceof SessionEventParseError
        && error.code === "unknown-ignorable"
      ) {
        continue;
      }
      throw new SessionLogUnreadableError(
        id,
        row.seq,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return events;
}

/**
 * Expand a physical suffix until at least `maxLogical` events (or the whole log).
 * Rows are read newest-first then reversed so the result is a chronological suffix.
 */
/**
 * True when `hintedCount` is safe as a logical length for absolute seq.
 * Packed logs with a stale physical backfill look like count === row count.
 */
function eventCountLooksLogical(
  db: DatabaseSync,
  id: string,
  hintedCount: number,
): boolean {
  const physical =
    (db
      .prepare("SELECT COUNT(*) AS n FROM events WHERE session_id = ?")
      .get(id) as { n: number } | undefined)?.n ?? 0;
  if (hintedCount > physical) return true;
  if (hintedCount < physical) return false;
  // Equal: only safe when no packed chunk rows (1 event per physical row).
  const packed = db
    .prepare(
      `SELECT 1 AS hit FROM events WHERE session_id = ? AND (
         json_extract(payload, '$.type') = 'text-chunks'
         OR json_extract(payload, '$.type') = 'tool-call-chunks'
       ) LIMIT 1`,
    )
    .get(id) as { hit: number } | undefined;
  return packed === undefined;
}

function loadSessionEventsTail(
  db: DatabaseSync,
  id: string,
  maxLogical: number,
): SessionEvent[] {
  if (maxLogical <= 0) return [];
  const rows = db
    .prepare(
      "SELECT seq, payload FROM events WHERE session_id = ? ORDER BY seq DESC",
    )
    .all(id) as { seq: number; payload: string }[];
  const newestFirst: SessionEvent[][] = [];
  let logical = 0;
  for (const row of rows) {
    try {
      const expanded = parseStoragePayload(row.payload);
      newestFirst.push(expanded);
      logical += expanded.length;
      if (logical >= maxLogical) break;
    } catch (error) {
      if (
        error instanceof SessionEventParseError
        && error.code === "unknown-ignorable"
      ) {
        continue;
      }
      throw new SessionLogUnreadableError(
        id,
        row.seq,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  const out: SessionEvent[] = [];
  for (let i = newestFirst.length - 1; i >= 0; i--) {
    out.push(...newestFirst[i]!);
  }
  return out;
}

/** Visit non-packed durable events in seq order (no chunk expansion). */
function scanDurableSinglesFromDb(
  db: DatabaseSync,
  id: string,
  visit: (event: SessionEvent) => void,
): void {
  const rows = db
    .prepare(
      "SELECT seq, payload FROM events WHERE session_id = ? ORDER BY seq ASC",
    )
    .all(id) as { seq: number; payload: string }[];
  for (const row of rows) {
    let raw: unknown;
    try {
      raw = JSON.parse(row.payload);
    } catch (error) {
      throw new SessionLogUnreadableError(
        id,
        row.seq,
        error instanceof Error ? error.message : String(error),
      );
    }
    if (isPackedChunkRow(raw)) continue;
    try {
      visit(assertSessionEvent(raw));
    } catch (error) {
      if (
        error instanceof SessionEventParseError
        && error.code === "unknown-ignorable"
      ) {
        continue;
      }
      throw new SessionLogUnreadableError(
        id,
        row.seq,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function nextSeqFromDb(db: DatabaseSync, sessionId: string): number {
  const row = db
    .prepare(
      "SELECT COALESCE(MAX(seq), -1) AS maxSeq FROM events WHERE session_id = ?",
    )
    .get(sessionId) as { maxSeq: number };
  return row.maxSeq + 1;
}

function hasTurnStartInDb(db: DatabaseSync, sessionId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS hit FROM events
       WHERE session_id = ? AND json_extract(payload, '$.type') = 'turn/start'
       LIMIT 1`,
    )
    .get(sessionId) as { hit: number } | undefined;
  return row !== undefined;
}

function hasCommandRunInDb(db: DatabaseSync, sessionId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS hit FROM events
       WHERE session_id = ? AND json_extract(payload, '$.type') = 'command/run'
       LIMIT 1`,
    )
    .get(sessionId) as { hit: number } | undefined;
  return row !== undefined;
}

function lastEventTsFromDb(db: DatabaseSync, sessionId: string): number | null {
  const row = db
    .prepare("SELECT MAX(ts) AS ts FROM events WHERE session_id = ?")
    .get(sessionId) as { ts: number | null } | undefined;
  return row?.ts ?? null;
}

/**
 * v4 fast path: read the maintained hint columns instead of scanning `events`.
 * Returns undefined for rows the backfill never touched (pre-v4 archive DB,
 * or a session whose events were removed) so callers keep the legacy scans.
 */
function sessionHintsFromDb(
  db: DatabaseSync,
  sessionId: string,
): SessionListHints | undefined {
  let row:
    | {
        last_ts: number;
        event_count: number;
        has_turn_start: number;
        has_command_run: number;
      }
    | undefined;
  try {
    row = db
      .prepare(
        "SELECT last_ts, event_count, has_turn_start, has_command_run FROM sessions WHERE id = ?",
      )
      .get(sessionId) as typeof row;
  } catch {
    return undefined;
  }
  if (row === undefined || row.event_count <= 0) return undefined;
  return {
    lastEventTs: row.last_ts > 0 ? row.last_ts : null,
    eventCount: row.event_count,
    hasTurnStart: row.has_turn_start === 1,
    hasCommandRun: row.has_command_run === 1,
  };
}

function loadSessionIds(db: DatabaseSync): Set<string> {
  const ids = new Set<string>();
  const rows = db.prepare("SELECT id FROM sessions").all() as { id: string }[];
  for (const { id } of rows) ids.add(id);
  return ids;
}

/**
 * Durable SessionStore: hot `sessions.db` + cold `sessions-archive.db` (WAL).
 * Lazy session load; batched chunk writes packed as `text-chunks` (≥3);
 * tool-call argument deltas pack as `tool-call-chunks` (≥3);
 * FTS5 trigram search. In-memory API stays flat SessionEvent[].
 * Archive offload moves rows to the cold file so the hot DB can shrink.
 */
export function createPersistentSessionStore(
  dir: string,
  options: PersistentSessionStoreOptions = {},
): PersistentSessionStore {
  const maxResident =
    options.maxResidentSessions ?? DEFAULT_MAX_RESIDENT_SESSIONS;
  const shared = Boolean(options.shared);
  const root = path.resolve(dir);
  mkdirSync(root, { recursive: true });
  const writeLock: SessionsDirLock | undefined = shared
    ? undefined
    : acquireSessionsDirLock(root);
  const dbPath = path.join(root, DB_NAME);
  const archivePath = path.join(root, ARCHIVE_DB_NAME);
  const journalMode = resolveSqliteJournalMode(root);
  if (journalMode === "DELETE") {
    console.warn(
      `[session-store] using SQLite DELETE journal for ${root} (network/sync volume or XRK_SQLITE_JOURNAL=DELETE); WAL is unsafe on remote filesystems`,
    );
  }
  let db: DatabaseSync;
  let archiveDb: DatabaseSync;
  try {
    db = openDatabase(dbPath, shared);
    if (!shared) {
      initSchema(db, journalMode);
    }
    archiveDb = openDatabase(archivePath, shared);
    if (!shared) {
      initSchema(archiveDb, journalMode);
    }
  } catch (err) {
    writeLock?.release();
    throw err;
  }

  const assertWritable = (): void => {
    if (shared) {
      throw new Error(
        "persistent session store is read-only when opened with { shared: true }",
      );
    }
  };

  const hotIds = loadSessionIds(db);
  const coldIds = loadSessionIds(archiveDb);
    // Incomplete move left the id in both files — keep hot, drop cold copy.
    for (const id of [...coldIds]) {
      if (hotIds.has(id)) {
        try {
          withImmediate(archiveDb, () => deleteSessionRows(archiveDb, id));
        } catch {
          /* best-effort */
        }
        coldIds.delete(id);
      }
    }
  const sessionIds = new Set<string>([...hotIds, ...coldIds]);
  const sessions = new Map<string, SessionEvent[]>();
  const residentOrder: string[] = [];
  let onEvict: ((sessionId: string) => void) | undefined;
  const nextSeqBySession = new Map<string, number>();
  let pending: PendingEvent[] = [];

  const restoreSeqMap = (snapshot: Map<string, number>): void => {
    nextSeqBySession.clear();
    for (const [k, v] of snapshot) nextSeqBySession.set(k, v);
  };

  const touchResident = (id: string): void => {
    const idx = residentOrder.indexOf(id);
    if (idx >= 0) residentOrder.splice(idx, 1);
    residentOrder.push(id);
  };

  const evictResidents = (keepId?: string): void => {
    while (sessions.size >= maxResident) {
      // Pin open turns: re-hydrate runs repairOpenTurnEvents and can insert an
      // interrupted assistant(toolCalls) while the live loop is still
      // streaming; a later complete assistant then breaks OpenAI tool-call
      // adjacency (HTTP 400). When every resident is pinned, allow temporary
      // over-capacity rather than evicting an in-flight turn.
      const victim = residentOrder.find((sid) => {
        if (sid === keepId) return false;
        const events = sessions.get(sid);
        return events === undefined || !sessionHasOpenTurn(events);
      });
      if (victim === undefined) break;
      // Drain this victim's batches before Face checkpoints / drops the log.
      // Other sessions stay pending so eviction does not stall their turns.
      flushPending(victim);
      // Notify while still resident so Face can checkpoint. Do not remove from
      // residentOrder yet — onEvict may touchResident via readEvents/get; splice
      // only after the callback so a re-touch cannot leave a stale LRU entry.
      onEvict?.(victim);
      sessions.delete(victim);
      const idx = residentOrder.indexOf(victim);
      if (idx >= 0) residentOrder.splice(idx, 1);
    }
  };

  const insertSession = shared
    ? undefined
    : db.prepare("INSERT INTO sessions (id) VALUES (?)");
  const insertEvent = shared
    ? undefined
    : db.prepare(
        "INSERT INTO events (session_id, seq, ts, payload) VALUES (?, ?, ?, ?)",
      );
  const insertFts = shared
    ? undefined
    : db.prepare(
        "INSERT INTO search_fts (session_id, seq, text) VALUES (?, ?, ?)",
      );
  // v4 list hints: maintained inside the same write transaction as the events,
  // so `session.list` never has to scan `events` again. `MAX(...)` keeps the
  // newest ts and the sticky flags monotonic under out-of-order batches.
  const upsertSessionHints = shared
    ? undefined
    : db.prepare(
        `INSERT INTO sessions (id, last_ts, event_count, has_turn_start, has_command_run)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           last_ts = MAX(sessions.last_ts, excluded.last_ts),
           event_count = sessions.event_count + excluded.event_count,
           has_turn_start = MAX(sessions.has_turn_start, excluded.has_turn_start),
           has_command_run = MAX(sessions.has_command_run, excluded.has_command_run)`,
      );
  /**
   * Append-only flush: **add** this batch's length to `event_count`.
   * Do not use for seed / replacePrefix / repair (those need an absolute set).
   */
  const bumpSessionHints = (
    sessionId: string,
    events: readonly SessionEvent[],
  ): void => {
    if (upsertSessionHints === undefined) return;
    let lastTs = 0;
    let turnStart = 0;
    let commandRun = 0;
    for (const event of events) {
      if (event.ts > lastTs) lastTs = event.ts;
      if (event.type === "turn/start") turnStart = 1;
      else if (event.type === "command/run") commandRun = 1;
    }
    upsertSessionHints.run(sessionId, lastTs, events.length, turnStart, commandRun);
  };

  /**
   * Absolute list hints from a full logical log (seed / truncate / hydrate repair).
   * `bumpSessionHints` alone would ADD `events.length` onto a stale counter.
   */
  const setSessionHints = (
    sessionId: string,
    events: readonly SessionEvent[],
  ): void => {
    if (shared) return;
    let lastTs = 0;
    let turnStart = 0;
    let commandRun = 0;
    for (const event of events) {
      if (event.ts > lastTs) lastTs = event.ts;
      if (event.type === "turn/start") turnStart = 1;
      else if (event.type === "command/run") commandRun = 1;
    }
    db.prepare(
      "UPDATE sessions SET last_ts = ?, event_count = ?, has_turn_start = ?, has_command_run = ? WHERE id = ?",
    ).run(lastTs, events.length, turnStart, commandRun, sessionId);
  };

  const allocateSeq = (sessionId: string): number => {
    let next = nextSeqBySession.get(sessionId);
    if (next === undefined) {
      next = nextSeqFromDb(db, sessionId);
    }
    nextSeqBySession.set(sessionId, next + 1);
    return next;
  };

  const writeRecord = (sessionId: string, record: PackedStorageRecord): void => {
    const seq = allocateSeq(sessionId);
    insertEvent!.run(sessionId, seq, storageTs(record), JSON.stringify(record));
    // `text-chunks` rows are indexed by `indexJoinedTextChunks`, whose row
    // carries the flush-boundary prefix and therefore the whole text of this
    // row as a strict subset. Writing both stored the same conversation twice
    // in `search_fts` (measured: 165 fully-overlapping (session_id, seq)
    // pairs in one live session), doubling the index and every archive /
    // restore / delete copy of it. `MATCH` recall is unchanged: the kept row
    // is the superset, and search only returns DISTINCT session_id.
    if (isTextChunkRow(record)) return;
    const text = extractStorageSearchText(record);
    if (text) insertFts!.run(sessionId, seq, text);
  };

  const indexJoinedTextChunks = (sessionId: string, events: readonly SessionEvent[]): void => {
    const firstText = events.find(
      (event) =>
        event.type === "assistant/chunk"
        && event.kind === "text"
        && event.text,
    );
    const prefix = firstText
      ? previousTextChunk(sessions.get(sessionId) ?? [], firstText)
      : "";
    const joined = textChunkSearchJoin(events, prefix);
    if (!joined) return;
    const seq = Math.max(0, (nextSeqBySession.get(sessionId) ?? 1) - 1);
    insertFts!.run(sessionId, seq, joined);
  };

  /** Per-session pending length. Avoids scanning the whole queue on every append. */
  const pendingCount = new Map<string, number>();
  const notePending = (sessionId: string, delta: number): void => {
    const next = (pendingCount.get(sessionId) ?? 0) + delta;
    if (next <= 0) pendingCount.delete(sessionId);
    else pendingCount.set(sessionId, next);
  };

  const WAL_SHRINK_MIN_BYTES =
    options.walShrinkMinBytes ?? 64 * 1024 * 1024;
  const WAL_SHRINK_INTERVAL_MS = options.walShrinkIntervalMs ?? 60_000;
  let lastWalShrinkAt = 0;

  /** `-wal` size, or 0 when the file does not exist (nothing pending). */
  const walBytes = (file: string): number => {
    try {
      return statSync(`${file}-wal`).size;
    } catch {
      return 0;
    }
  };

  /**
   * `TRUNCATE` gives the disk space back; `PASSIVE`/`FULL` only copy frames
   * into the database and leave the file at its peak size.
   *
   * One statement does both the checkpoint and the busy report: a separate
   * PASSIVE probe first left its statement open (node:sqlite finalizes on GC),
   * which made the following TRUNCATE see `busy`. This connection has no
   * `busy_timeout`, so a real reader returns `busy` immediately instead of
   * stalling a flush.
   */
  const walCheckpointTruncate = (conn: DatabaseSync): void => {
    try {
      conn.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    } catch (error) {
      /* busy reader or closed mid-flush — the next flush retries */
      if (DEBUG_WAL_CHECKPOINT) {
        console.error("[session-store] wal checkpoint failed:", error);
      }
    }
  };

  /**
   * Shrink a WAL that outgrew `journal_size_limit` while the process stayed up.
   *
   * `wal_autocheckpoint` keeps copying frames back into the database, but the
   * file itself only shrinks on a TRUNCATE checkpoint — and this store only did
   * that in `close()`. A Host that runs for days therefore kept its historical
   * peak next to the database (measured: a 561 MB `-wal` beside a 788 MB file,
   * with every frame already durable). PASSIVE runs first because it never
   * blocks and reports whether a reader still pins the log; TRUNCATE only
   * follows when nothing is busy, and this connection has no `busy_timeout`, so
   * a reader that appears in between makes TRUNCATE return `busy` instead of
   * stalling the flush.
   */
  const shrinkWal = (): void => {
    if (shared || journalMode !== "WAL") return;
    const targets: Array<readonly [DatabaseSync, string]> = [
      [db, dbPath],
      [archiveDb, archivePath],
    ];
    // Stat before the rate limit: the common flush has no oversized WAL, and
    // skipping the clock check keeps the next real overflow from waiting out
    // an interval that a harmless flush consumed.
    const over = targets.filter(
      ([, file]) => walBytes(file) >= WAL_SHRINK_MIN_BYTES,
    );
    if (over.length === 0) return;
    const now = Date.now();
    if (now - lastWalShrinkAt < WAL_SHRINK_INTERVAL_MS) return;
    lastWalShrinkAt = now;
    for (const [conn] of over) walCheckpointTruncate(conn);
  };

  const flushPending = (onlySessionId?: string): void => {
    if (shared || pending.length === 0) {
      // Nothing to write, but the WAL may still hold a peak from earlier
      // flushes — this is the cheapest place to notice and reclaim it.
      shrinkWal();
      return;
    }
    const batch: PendingEvent[] = [];
    if (onlySessionId === undefined) {
      batch.push(...pending);
      pending = [];
      pendingCount.clear();
    } else {
      const rest: PendingEvent[] = [];
      for (const row of pending) {
        if (row.sessionId === onlySessionId) batch.push(row);
        else rest.push(row);
      }
      if (batch.length === 0) return;
      pending = rest;
      notePending(onlySessionId, -batch.length);
    }
    const order: string[] = [];
    const bySession = new Map<string, SessionEvent[]>();
    for (const row of batch) {
      let list = bySession.get(row.sessionId);
      if (!list) {
        list = [];
        bySession.set(row.sessionId, list);
        order.push(row.sessionId);
      }
      list.push(row.event);
    }
    const seqSnapshot = new Map(nextSeqBySession);
    // Human input is the one thing a power cut must not swallow: upgrade to
    // FULL for the transaction carrying it, then fall back to NORMAL. PRAGMA
    // synchronous cannot change inside a transaction, so it brackets BEGIN.
    // BEGIN (and the FULL pragma) must sit inside try: a busy/IO throw before
    // COMMIT would otherwise drop `batch` from `pending` with no restore.
    const needsFullSync = batch.some((row) => row.event.type === "user/message");
    try {
      if (needsFullSync) db.exec("PRAGMA synchronous = FULL");
      db.exec("BEGIN IMMEDIATE");
      for (const sessionId of order) {
        const events = bySession.get(sessionId)!;
        const packed = packChunkRunsForExport(events);
        for (const record of packed) {
          writeRecord(sessionId, record);
        }
        indexJoinedTextChunks(sessionId, events);
        bumpSessionHints(sessionId, events);
      }
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* already rolled back / closed / never began */
      }
      restoreSeqMap(seqSnapshot);
      // Prepend this flush's batch so later flush/close can retry; keep any
      // events appended while this flush ran, including other sessions.
      for (const row of batch) notePending(row.sessionId, 1);
      pending = batch.concat(pending);
      throw err;
    } finally {
      if (needsFullSync) {
        try {
          db.exec("PRAGMA synchronous = NORMAL");
        } catch {
          /* closed mid-flush */
        }
      }
    }
    shrinkWal();
  };

  const persistImmediate = (id: string, frozen: SessionEvent): void => {
    writeRecord(id, frozen);
  };

  /**
   * Events that must reach disk before the next macrotask — user input and
   * turn lifecycle edges. Crash repair (`repairOpenTurnEvents`) closes every
   * `turn/start` that never got a `turn/end`, but it can only settle what
   * reached disk; a queued user message would be silently lost, and a missing
   * `turn/start` would open a turn the repair pass cannot see.
   *
   * Flush is scheduled on a microtask (not sync) so Face mux publish can run
   * in the same call stack after `append` returns; host idle/close `flush()`
   * and that session's pending-length cap still drain synchronously.
   * The microtask writes only sessions that hit a boundary, not every
   * session sharing the queue.
   */
  const isDurabilityBoundary = (frozen: SessionEvent): boolean =>
    frozen.type === "user/message" ||
    frozen.type === "turn/start" ||
    frozen.type === "turn/end" ||
    frozen.type.startsWith("command/") ||
    frozen.type.startsWith("prompt/");

  const flushMicrotaskIds = new Set<string>();
  let flushMicrotaskQueued = false;
  let storeClosed = false;
  let backgroundFlushFailures = 0;
  let backgroundFlushPaused = false;
  let lastBackgroundFlushError: string | undefined;
  const scheduleFlushPending = (sessionId: string): void => {
    if (shared || storeClosed || backgroundFlushPaused) return;
    flushMicrotaskIds.add(sessionId);
    if (flushMicrotaskQueued) return;
    flushMicrotaskQueued = true;
    queueMicrotask(() => {
      flushMicrotaskQueued = false;
      if (storeClosed || backgroundFlushPaused) {
        flushMicrotaskIds.clear();
        return;
      }
      const ids = [...flushMicrotaskIds];
      flushMicrotaskIds.clear();
      for (const id of ids) {
        try {
          flushPending(id);
        } catch (error) {
          /* pending restored inside flushPending; close()/flush() retries */
          // A retry that never succeeds is data loss with no trail: the events
          // look saved in memory and vanish on exit. Pause auto-drain (DSH) so
          // the next explicit flush()/close() is the only path forward.
          backgroundFlushFailures += 1;
          backgroundFlushPaused = true;
          lastBackgroundFlushError =
            error instanceof Error ? error.message : String(error);
          if (backgroundFlushFailures <= 3 || backgroundFlushFailures % 100 === 0) {
            console.error(
              `[session-store] background flush failed #${backgroundFlushFailures}`
              + ` for ${id}; auto-drain paused, events stay queued: `
              + lastBackgroundFlushError,
            );
          }
        }
      }
    });
  };

  const persistEvent = (id: string, frozen: SessionEvent): void => {
    pending.push({ sessionId: id, event: frozen });
    notePending(id, 1);
    if ((pendingCount.get(id) ?? 0) >= MICRO_BATCH_MAX_PENDING) {
      flushPending(id);
      return;
    }
    if (isDurabilityBoundary(frozen)) {
      scheduleFlushPending(id);
    }
  };

  const sourceDbFor = (id: string): DatabaseSync =>
    coldIds.has(id) ? archiveDb : db;

  const dropResident = (id: string): void => {
    sessions.delete(id);
    nextSeqBySession.delete(id);
    const idx = residentOrder.indexOf(id);
    if (idx >= 0) residentOrder.splice(idx, 1);
  };

  const ensureLoaded = (id: string): SessionEvent[] => {
    const cached = sessions.get(id);
    if (cached !== undefined) {
      touchResident(id);
      return cached;
    }

    evictResidents(id);

    const offloaded = coldIds.has(id);
    const events = loadSessionEvents(sourceDbFor(id), id);
    const repairs = repairOpenTurnEvents(events);
    if (repairs.length > 0) {
      const frozenRepairs = repairs.map((ev) => freezeSessionEvent(ev));
      // Cold / shared: memory-only repair (archive is read for turns; shared is RO).
      if (!shared && !offloaded) {
        const seqSnapshot = new Map(nextSeqBySession);
        db.exec("BEGIN IMMEDIATE");
        try {
          for (const frozen of frozenRepairs) {
            persistImmediate(id, frozen);
          }
          // Repairs are appends — bump; absolute set happens below against the
          // full logical log (also heals stale event_count from older builds).
          bumpSessionHints(id, frozenRepairs);
          db.exec("COMMIT");
        } catch (err) {
          try {
            db.exec("ROLLBACK");
          } catch {
            /* ignore */
          }
          restoreSeqMap(seqSnapshot);
          throw err;
        }
      }
      // Shared / cold: apply repair in memory only. Exclusive hot: durable
      // first, then memory — crash between COMMIT and push re-repairs on reload.
      events.push(...frozenRepairs);
    }
    sessions.set(id, events);
    touchResident(id);
    // Heal durable event_count when it drifted (R7 ADD-bug / partial bump).
    // R8 cold tail keys absolute seq off this column.
    if (!shared && !offloaded) {
      const hinted = sessionHintsFromDb(sourceDbFor(id), id)?.eventCount;
      if (hinted !== events.length) {
        try {
          setSessionHints(id, events);
        } catch {
          /* RO / closed */
        }
      }
    }
    return events;
  };

  const assertHotMutable = (id: string): void => {
    if (coldIds.has(id)) {
      throw new Error(`session is archived offload (read-only): ${id}`);
    }
  };

  return {
    create(id = newSessionId()): SessionRecord {
      assertWritable();
      const sid = assertSafeId(id);
      if (sessionIds.has(sid)) {
        throw new Error(`session already exists: ${sid}`);
      }
      sessionIds.add(sid);
      hotIds.add(sid);
      evictResidents(sid);
      sessions.set(sid, []);
      touchResident(sid);
      nextSeqBySession.set(sid, 0);
      insertSession!.run(sid);
      return { id: sid, events: [] };
    },

    get(id: string): SessionRecord {
      if (!sessionIds.has(id)) {
        throw new Error(`session not found: ${id}`);
      }
      const events = ensureLoaded(id);
      return { id, events };
    },

    has(id: string): boolean {
      return sessionIds.has(id);
    },

      delete(id: string): void {
        assertWritable();
        const sid = assertSafeId(id);
        if (!sessionIds.has(sid)) return;
        flushPending(sid);
        if (hotIds.has(sid)) {
          withImmediate(db, () => deleteSessionRows(db, sid));
          hotIds.delete(sid);
        }
        if (coldIds.has(sid)) {
          withImmediate(archiveDb, () => deleteSessionRows(archiveDb, sid));
          coldIds.delete(sid);
        }
        sessionIds.delete(sid);
        dropResident(sid);
      },

    reclaimStorage(): boolean {
      if (shared) return false;
      assertWritable();
      flushPending();
      const hot = maybeVacuum(db, {
        minFreeBytes: VACUUM_EXPLICIT_MIN_FREE_BYTES,
        minFreeRatio: VACUUM_EXPLICIT_MIN_FREE_RATIO,
      });
      const cold = maybeVacuum(archiveDb, {
        minFreeBytes: VACUUM_EXPLICIT_MIN_FREE_BYTES,
        minFreeRatio: VACUUM_EXPLICIT_MIN_FREE_RATIO,
      });
      return hot || cold;
    },

    offloadToArchive(id: string): void {
      assertWritable();
      const sid = assertSafeId(id);
      if (!sessionIds.has(sid)) {
        throw new Error(`session not found: ${sid}`);
      }
        if (coldIds.has(sid)) return;
        flushPending(sid);
        copySessionRows(db, archiveDb, sid);
        withImmediate(db, () => deleteSessionRows(db, sid));
        hotIds.delete(sid);
        coldIds.add(sid);
        dropResident(sid);
        maybeVacuum(db, {
        minFreeBytes: VACUUM_EXPLICIT_MIN_FREE_BYTES,
        minFreeRatio: VACUUM_EXPLICIT_MIN_FREE_RATIO,
      });
    },

    restoreFromArchive(id: string): void {
      assertWritable();
      const sid = assertSafeId(id);
      if (!sessionIds.has(sid)) {
        throw new Error(`session not found: ${sid}`);
      }
        if (!coldIds.has(sid)) return;
        flushPending(sid);
        copySessionRows(archiveDb, db, sid);
        withImmediate(archiveDb, () => deleteSessionRows(archiveDb, sid));
        coldIds.delete(sid);
        hotIds.add(sid);
        dropResident(sid);
      maybeVacuum(archiveDb, {
        minFreeBytes: VACUUM_EXPLICIT_MIN_FREE_BYTES,
        minFreeRatio: VACUUM_EXPLICIT_MIN_FREE_RATIO,
      });
    },

    isOffloaded(id: string): boolean {
      return coldIds.has(id);
    },

    append(id: string, event: SessionEvent): SessionEvent {
      assertWritable();
      if (!sessionIds.has(id)) {
        throw new Error(`session not found: ${id}`);
      }
      assertHotMutable(id);
      const events = ensureLoaded(id);
      const frozen = freezeSessionEvent(event);
      events.push(frozen);
      try {
        persistEvent(id, frozen);
      } catch (err) {
        events.pop();
        // flushPending restores the whole batch on ROLLBACK; drop only this
        // append so prior pending chunks remain retryable.
        for (let i = pending.length - 1; i >= 0; i -= 1) {
          if (pending[i]!.event === frozen) {
            pending.splice(i, 1);
            notePending(id, -1);
            break;
          }
        }
        throw err;
      }
      return frozen;
    },

    seed(id = newSessionId(), eventsInput: readonly SessionEvent[] = []): SessionRecord {
      assertWritable();
      const sid = assertSafeId(id);
      if (sessionIds.has(sid)) {
        throw new Error(`session already exists: ${sid}`);
      }
      const frozen: SessionEvent[] = [];
      for (const event of eventsInput) {
        frozen.push(freezeSessionEvent(event));
      }
      // Create + one packed transaction (not N persistEvent flushes). Chunk
      // runs pack the same way as flushPending so fork seed matches live shape.
      sessionIds.add(sid);
      hotIds.add(sid);
      evictResidents(sid);
      sessions.set(sid, frozen);
      touchResident(sid);
      nextSeqBySession.set(sid, 0);
      insertSession!.run(sid);
      if (frozen.length === 0) {
        return { id: sid, events: frozen };
      }
      const seqSnapshot = new Map(nextSeqBySession);
      db.exec("BEGIN IMMEDIATE");
      try {
        const packed = packChunkRunsForExport(frozen);
        for (const record of packed) {
          writeRecord(sid, record);
        }
        indexJoinedTextChunks(sid, frozen);
        // Same hints `replacePrefix` maintains. Without this a freshly forked
        // child sits at event_count 0 / has_turn_start 0 until its first
        // non-turn-start append, at which point the hint reader stops falling
        // back to an event scan and `blank` flips true — the sidebar then
        // offers the new-session button a 6-figure-event branch to reuse.
        setSessionHints(sid, frozen);
        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* already rolled back / closed */
        }
        restoreSeqMap(seqSnapshot);
        sessionIds.delete(sid);
        hotIds.delete(sid);
        dropResident(sid);
        try {
          db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
        } catch {
          /* best-effort undo of the sessions row */
        }
        throw err;
      }
      return { id: sid, events: frozen };
    },

    /**
     * Fork R6: `INSERT…SELECT` the parent's durable prefix, then write only
     * `suffix` (closers + end-seed). Returns undefined → {@link forkSession}
     * falls back to full `seed` (packed row straddles the cut, or cold source).
     */
    seedFromSession(
      sourceId: string,
      keepLogical: number,
      childId: string | undefined,
      suffix: readonly SessionEvent[],
    ): SessionRecord | undefined {
      assertWritable();
      const src = assertSafeId(sourceId);
      if (!sessionIds.has(src) || coldIds.has(src)) return undefined;
      flushPending(src);
      assertHotMutable(src);

      const sourceEvents = ensureLoaded(src);
      if (keepLogical > sourceEvents.length) return undefined;
      const cut = physicalTailCutSeq(db, src, keepLogical, sourceEvents.length);
      if (cut === "rewrite") return undefined;

      const sid = assertSafeId(childId ?? newSessionId());
      if (sessionIds.has(sid)) {
        throw new Error(`session already exists: ${sid}`);
      }
      const prefix = sourceEvents.slice(0, keepLogical);
      const frozenSuffix: SessionEvent[] = [];
      for (const event of suffix) {
        frozenSuffix.push(freezeSessionEvent(event));
      }
      const frozen = prefix.concat(frozenSuffix);

      const sourceNext =
        nextSeqBySession.get(src) ?? nextSeqFromDb(db, src);
      const nextAfterCopy =
        cut === "empty" ? 0 : cut === "noop" ? sourceNext : cut;

      sessionIds.add(sid);
      hotIds.add(sid);
      evictResidents(sid);
      sessions.set(sid, frozen);
      touchResident(sid);
      nextSeqBySession.set(sid, nextAfterCopy);
      insertSession!.run(sid);

      const seqSnapshot = new Map(nextSeqBySession);
      db.exec("BEGIN IMMEDIATE");
      try {
        if (cut === "noop") {
          db.prepare(
            "INSERT INTO events (session_id, seq, ts, payload) "
              + "SELECT ?, seq, ts, payload FROM events WHERE session_id = ?",
          ).run(sid, src);
          db.prepare(
            "INSERT INTO search_fts (session_id, seq, text) "
              + "SELECT ?, seq, text FROM search_fts WHERE session_id = ?",
          ).run(sid, src);
        } else if (typeof cut === "number") {
          db.prepare(
            "INSERT INTO events (session_id, seq, ts, payload) "
              + "SELECT ?, seq, ts, payload FROM events WHERE session_id = ? AND seq < ?",
          ).run(sid, src, cut);
          db.prepare(
            "INSERT INTO search_fts (session_id, seq, text) "
              + "SELECT ?, seq, text FROM search_fts WHERE session_id = ? AND seq < ?",
          ).run(sid, src, cut);
        }
        if (frozenSuffix.length > 0) {
          const packed = packChunkRunsForExport(frozenSuffix);
          for (const record of packed) {
            writeRecord(sid, record);
          }
          indexJoinedTextChunks(sid, frozenSuffix);
        }
        setSessionHints(sid, frozen);
        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* already rolled back / closed */
        }
        restoreSeqMap(seqSnapshot);
        sessionIds.delete(sid);
        hotIds.delete(sid);
        dropResident(sid);
        try {
          db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
        } catch {
          /* best-effort */
        }
        throw err;
      }
      return { id: sid, events: frozen };
    },

    replacePrefix(id: string, eventsInput: readonly SessionEvent[] = []): SessionRecord {
      assertWritable();
      const sid = assertSafeId(id);
      if (!sessionIds.has(sid)) {
        throw new Error(`session not found: ${sid}`);
      }
      assertHotMutable(sid);
      flushPending(sid);
      const frozen: SessionEvent[] = [];
      for (const event of eventsInput) {
        frozen.push(freezeSessionEvent(event));
      }

      // Fast path (edit-resubmit / truncate): prefix unchanged → DELETE tail
      // rows only. Full wipe+rewrite was ~1.6s on a 16k-event session.
      const current = ensureLoaded(sid);
      if (
        frozen.length <= current.length
        && logicalEventsEqualPrefix(current, frozen)
      ) {
        const cut = physicalTailCutSeq(
          db,
          sid,
          frozen.length,
          current.length,
        );
        if (cut === "noop") {
          sessions.set(sid, frozen);
          touchResident(sid);
          return { id: sid, events: frozen };
        }
        if (cut === "empty" || typeof cut === "number") {
          const seqSnapshot = new Map(nextSeqBySession);
          db.exec("BEGIN IMMEDIATE");
          try {
            if (cut === "empty") {
              db.prepare("DELETE FROM search_fts WHERE session_id = ?").run(sid);
              db.prepare("DELETE FROM events WHERE session_id = ?").run(sid);
              nextSeqBySession.set(sid, 0);
            } else {
              db.prepare(
                "DELETE FROM search_fts WHERE session_id = ? AND seq >= ?",
              ).run(sid, cut);
              db.prepare(
                "DELETE FROM events WHERE session_id = ? AND seq >= ?",
              ).run(sid, cut);
              nextSeqBySession.set(sid, cut);
            }
            if (frozen.length === 0) {
              db.prepare(
                "UPDATE sessions SET last_ts = 0, event_count = 0, has_turn_start = 0, has_command_run = 0 WHERE id = ?",
              ).run(sid);
            } else {
              setSessionHints(sid, frozen);
            }
            db.exec("COMMIT");
          } catch (err) {
            try {
              db.exec("ROLLBACK");
            } catch {
              /* already rolled back / closed */
            }
            restoreSeqMap(seqSnapshot);
            throw err;
          }
          sessions.set(sid, frozen);
          touchResident(sid);
          return { id: sid, events: frozen };
        }
        // cut === "rewrite" (packed row straddles the logical boundary)
      }

      const seqSnapshot = new Map(nextSeqBySession);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM search_fts WHERE session_id = ?").run(sid);
        db.prepare("DELETE FROM events WHERE session_id = ?").run(sid);
        db.prepare(
          "UPDATE sessions SET last_ts = 0, event_count = 0, has_turn_start = 0, has_command_run = 0 WHERE id = ?",
        ).run(sid);
        nextSeqBySession.set(sid, 0);
        if (frozen.length > 0) {
          const packed = packChunkRunsForExport(frozen);
          for (const record of packed) {
            writeRecord(sid, record);
          }
          indexJoinedTextChunks(sid, frozen);
          setSessionHints(sid, frozen);
        }
        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* already rolled back / closed */
        }
        restoreSeqMap(seqSnapshot);
        throw err;
      }
      sessions.set(sid, frozen);
      touchResident(sid);
      return { id: sid, events: frozen };
    },

    list(): readonly string[] {
      return [...sessionIds];
    },

    listHints(id: string): SessionListHints {
      if (!sessionIds.has(id)) {
        throw new Error(`session not found: ${id}`);
      }
      const cached = sessions.get(id);
      if (cached !== undefined) {
        return computeListHints(cached);
      }
      const source = sourceDbFor(id);
      const hints = sessionHintsFromDb(source, id);
      if (hints !== undefined) return hints;
      // Pre-v4 rows (or a stripped archive) still fall back to the scans.
      const lastEventTs = lastEventTsFromDb(source, id);
      return {
        lastEventTs,
        eventCount:
          (source
            .prepare("SELECT COUNT(*) AS n FROM events WHERE session_id = ?")
            .get(id) as { n: number } | undefined)?.n ?? 0,
        hasTurnStart: hasTurnStartInDb(source, id),
        hasCommandRun: hasCommandRunInDb(source, id),
      };
    },

    isLoaded(id: string): boolean {
      return sessions.has(id);
    },

    readEventsTail(
      id: string,
      maxLogical: number,
    ):
      | { readonly events: readonly SessionEvent[]; readonly baseIndex: number }
      | undefined {
      if (!sessionIds.has(id)) {
        throw new Error(`session not found: ${id}`);
      }
      const cap = Math.max(0, Math.floor(maxLogical));
      if (cap <= 0) {
        return { events: [], baseIndex: 0 };
      }
      const cached = sessions.get(id);
      if (cached !== undefined) {
        touchResident(id);
        if (cached.length <= cap) {
          return { events: cached, baseIndex: 0 };
        }
        const baseIndex = cached.length - cap;
        return { events: cached.slice(baseIndex), baseIndex };
      }
      const source = sourceDbFor(id);
      const hints = sessionHintsFromDb(source, id);
      const total = hints?.eventCount;
      if (typeof total !== "number" || total <= 0) return undefined;
      // v4 hint backfill used physical COUNT(*). Packed sessions then report
      // event_count === row count while logical length is larger — refuse the
      // fast path so Face falls back to a full expand (correct absolute seq).
      if (!eventCountLooksLogical(source, id, total)) return undefined;
      const events = loadSessionEventsTail(source, id, cap);
      if (events.length === 0) return { events: [], baseIndex: total };
      if (events.length > total) return undefined;
      return { events, baseIndex: total - events.length };
    },

    scanDurableSingles(id: string, visit: (event: SessionEvent) => void): void {
      if (!sessionIds.has(id)) {
        throw new Error(`session not found: ${id}`);
      }
      const cached = sessions.get(id);
      if (cached !== undefined) {
        touchResident(id);
        for (const event of cached) visit(event);
        return;
      }
      scanDurableSinglesFromDb(sourceDbFor(id), id, visit);
    },

    searchSessionIds(query: string): readonly string[] {
      const plan = planFtsQuery(query);
      if (plan === null) return [];
      const ids = new Set<string>();
      // A common word ("session", "测试"→LIKE) matches thousands of rows. Face
      // shows 20 with a hasMore flag and then reads every candidate's full log,
      // so an uncapped candidate list pulls hundreds of sessions into the LRU
      // and evicts them again one by one.
      const CANDIDATE_LIMIT = 200;
      let ftsFailed = false;
      const run = (target: DatabaseSync): void => {
        try {
          const rows = (plan.kind === "match"
            ? target
              .prepare(
                "SELECT DISTINCT session_id AS id FROM search_fts WHERE search_fts MATCH ? LIMIT ?",
              )
              .all(plan.value, CANDIDATE_LIMIT)
            : target
              .prepare(
                "SELECT DISTINCT session_id AS id FROM search_fts WHERE text LIKE ? ESCAPE '\\' LIMIT ?",
              )
              .all(plan.value, CANDIDATE_LIMIT)) as { id: string }[];
          for (const row of rows) ids.add(row.id);
        } catch {
          /* corrupt / missing FTS — skip that DB, but say so below */
          ftsFailed = true;
        }
      };
      run(db);
      run(archiveDb);
      const needle = query.trim().toLowerCase();
      if (ftsFailed) {
        // A damaged index must not read as "no results": that is indistinguishable
        // from a real miss and sends the user hunting for content that is right
        // there. Scan the resident logs (the same text the index would hold) and
        // leave a throttled trace for diagnosis.
        for (const [id, events] of sessions) {
          if (ids.has(id)) continue;
          for (const event of events) {
            const text = extractEventSearchText(event);
            if (text !== undefined && text.toLowerCase().includes(needle)) {
              ids.add(id);
              break;
            }
          }
        }
        searchIndexFailures += 1;
        if (searchIndexFailures <= 3 || searchIndexFailures % 100 === 0) {
          console.error(
            `[session-store] search index unavailable (#${searchIndexFailures});`
            + " falling back to resident logs — rebuild FTS to restore cold search",
          );
        }
      }
      // Pending batches are not in FTS yet. Match them in memory so a search
      // does not COMMIT every other session's interior events.
      const chunkText = new Map<string, string>();
      for (const row of pending) {
        const text = extractEventSearchText(row.event);
        if (text && text.toLowerCase().includes(needle)) {
          ids.add(row.sessionId);
          continue;
        }
        if (
          row.event.type === "assistant/chunk"
          && row.event.kind === "text"
          && row.event.text
        ) {
          chunkText.set(
            row.sessionId,
            (chunkText.get(row.sessionId) ?? "") + row.event.text,
          );
        }
      }
      for (const [sessionId, text] of chunkText) {
        let hay = text;
        const firstPending = pending.find(
          (row) =>
            row.sessionId === sessionId
            && row.event.type === "assistant/chunk"
            && row.event.kind === "text"
            && row.event.text,
        )?.event;
        if (firstPending) {
          hay =
            previousTextChunk(sessions.get(sessionId) ?? [], firstPending) + hay;
        }
        if (hay.toLowerCase().includes(needle)) ids.add(sessionId);
      }
      return [...ids];
    },

    releaseResident(sessionId: string): boolean {
      const sid = sessionId;
      if (!sessionIds.has(sid)) return false;
      const events = sessions.get(sid);
      if (events === undefined) return true;
      // Same pin as LRU eviction: re-hydrate mid-turn would re-run repair and
      // can insert a synthetic interrupted assistant while the live loop still
      // streams.
      if (sessionHasOpenTurn(events)) return false;
      flushPending(sid);
      onEvict?.(sid);
      dropResident(sid);
      return true;
    },

    flushFailureReport() {
      return {
        failures: backgroundFlushFailures,
        paused: backgroundFlushPaused,
        ...(lastBackgroundFlushError !== undefined
          ? { lastError: lastBackgroundFlushError }
          : {}),
      };
    },

    flush(sessionId?: string) {
      flushPending(sessionId);
      // Explicit barrier cleared the pause — resume microtask auto-drain.
      backgroundFlushPaused = false;
      lastBackgroundFlushError = undefined;
    },

    close() {
      storeClosed = true;
      try {
        flushPending();
        if (!shared) {
          // Reclaim the WAL before VACUUM. `TRUNCATE` only succeeds when no
          // reader holds an old snapshot; a busy result is fine (next start
          // retries), and `journal_size_limit` caps the file meanwhile.
          try {
            db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
          } catch {
            /* busy reader — leave it for the next checkpoint */
          }
          try {
            archiveDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
          } catch {
            /* busy reader */
          }
          maybeVacuum(db, {
            minFreeBytes: VACUUM_MIN_FREE_BYTES,
            minFreeRatio: VACUUM_MIN_FREE_RATIO,
          });
          maybeVacuum(archiveDb, {
            minFreeBytes: VACUUM_MIN_FREE_BYTES,
            minFreeRatio: VACUUM_MIN_FREE_RATIO,
          });
        }
      } finally {
        try {
          db.close();
        } catch {
          /* already closed */
        }
        try {
          archiveDb.close();
        } catch {
          /* already closed */
        }
        writeLock?.release();
      }
    },

    eventsRef(id: string): readonly SessionEvent[] {
      if (!sessionIds.has(id)) {
        throw new Error(`session not found: ${id}`);
      }
      const events = sessions.get(id);
      if (events === undefined) {
        throw new Error(`session not resident: ${id}`);
      }
      return events;
    },

    readEvents(
      id: string,
      fromSeq = 0,
      toSeqExclusive?: number,
    ): readonly SessionEvent[] {
      if (!sessionIds.has(id)) {
        throw new Error(`session not found: ${id}`);
      }
      const events = ensureLoaded(id);
      return snapshotEvents({ id, events }, fromSeq, toSeqExclusive);
    },

    bindSessionEviction(handler: (sessionId: string) => void): void {
      onEvict = handler;
    },
  };
}

/** SQLite database filename under a sessions directory. */
export const SESSION_DB_FILENAME = DB_NAME;

/** Archive SQLite filename (cold session logs after `offloadToArchive`). */
export const SESSION_ARCHIVE_DB_FILENAME = ARCHIVE_DB_NAME;

/** Current durable schema version (text-chunks physical packing). */
export const SESSION_SCHEMA_VERSION = SCHEMA_VERSION;
