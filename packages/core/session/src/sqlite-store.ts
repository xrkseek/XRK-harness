import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { SessionEvent } from "@xrkseek/protocol";
import { assertSessionEvent } from "@xrkseek/protocol";
import {
  expandPackedStorageRecords,
  isPackedChunkRow,
  isTextChunkRow,
  isToolCallChunkRow,
  packChunkRunsForExport,
  type PackedStorageRecord,
} from "./chunk-pack.js";
import { deepFreeze, newSessionId } from "./freeze.js";
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

export {
  acquireSessionsDirLock,
  SessionsDirInUseError,
  SESSIONS_WRITE_LOCK_FILENAME,
  type SessionsDirLock,
} from "./store-lock.js";

function openDatabase(dbPath: string, readOnly = false): DatabaseSync {
  const { DatabaseSync: Db } = process.getBuiltinModule(
    "node:sqlite",
  );
  return readOnly ? new Db(dbPath, { readOnly: true }) : new Db(dbPath);
}

export interface PersistentSessionStore extends SessionStore {
  /** Flush batched chunk writes (also called from {@link close}). */
  flush(): void;
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
}

const ID_RE = /^[A-Za-z0-9._-]+$/;
/** Physical schema v3: durable rows may be packed chunk rows (expanded on load). */
const SCHEMA_VERSION = SQLITE_SCHEMA_CURRENT;
const DB_NAME = "sessions.db";
const DEFAULT_MAX_RESIDENT_SESSIONS = 8;

interface PendingEvent {
  readonly sessionId: string;
  readonly event: SessionEvent;
}

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

function initSchema(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
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
          id TEXT PRIMARY KEY
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
    ensureFts: () => {
      ensureFts(db);
    },
    rebuildFts: () => {
      ensureFts(db);
      rebuildFts(db);
    },
  };

  const stored = schemaVersion(db);
  if (stored >= SCHEMA_VERSION) {
    // Idempotent open on current schema — still ensure tables/FTS exist.
    hooks.ensureTables();
    hooks.ensureFts();
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

function loadSessionEvents(db: DatabaseSync, id: string): SessionEvent[] {
  const rows = db
    .prepare("SELECT payload FROM events WHERE session_id = ? ORDER BY seq ASC")
    .all(id) as { payload: string }[];
  const events: SessionEvent[] = [];
  for (const row of rows) {
    try {
      events.push(...parseStoragePayload(row.payload));
    } catch {
      break;
    }
  }
  return events;
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

function loadSessionIds(db: DatabaseSync): Set<string> {
  const ids = new Set<string>();
  const rows = db.prepare("SELECT id FROM sessions").all() as { id: string }[];
  for (const { id } of rows) ids.add(id);
  return ids;
}

/**
 * Durable SessionStore: one workspace SQLite file (`sessions.db`) with WAL.
 * Lazy session load; batched chunk writes packed as `text-chunks` (≥3);
 * tool-call argument deltas pack as `tool-call-chunks` (≥3);
 * FTS5 trigram search. In-memory API stays flat SessionEvent[].
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
  let db: DatabaseSync;
  try {
    db = openDatabase(dbPath, shared);
    if (!shared) {
      initSchema(db);
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

  const sessionIds = loadSessionIds(db);
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
      // Drain chunk batches before Face checkpoints / drops the resident log.
      flushPending();
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
    const text = extractStorageSearchText(record);
    if (text) insertFts!.run(sessionId, seq, text);
  };

  const flushPending = (): void => {
    if (shared || pending.length === 0) return;
    const batch = pending;
    pending = [];
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
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const sessionId of order) {
        const packed = packChunkRunsForExport(bySession.get(sessionId)!);
        for (const record of packed) {
          writeRecord(sessionId, record);
        }
      }
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* already rolled back / closed */
      }
      restoreSeqMap(seqSnapshot);
      // Prepend failed batch so later flush/close can retry; keep any events
      // appended while this flush ran.
      pending = batch.concat(pending);
      throw err;
    }
  };

  const persistImmediate = (id: string, frozen: SessionEvent): void => {
    writeRecord(id, frozen);
  };

  const persistEvent = (id: string, frozen: SessionEvent): void => {
    pending.push({ sessionId: id, event: frozen });
    if (frozen.type !== "assistant/chunk") {
      flushPending();
    }
  };

  const ensureLoaded = (id: string): SessionEvent[] => {
    const cached = sessions.get(id);
    if (cached !== undefined) {
      touchResident(id);
      return cached;
    }

    evictResidents(id);

    const events = loadSessionEvents(db, id);
    const repairs = repairOpenTurnEvents(events);
    if (repairs.length > 0) {
      const frozenRepairs = repairs.map((ev) =>
        deepFreeze(structuredClone(assertSessionEvent(ev))),
      );
      if (!shared) {
        const seqSnapshot = new Map(nextSeqBySession);
        db.exec("BEGIN IMMEDIATE");
        try {
          for (const frozen of frozenRepairs) {
            persistImmediate(id, frozen);
          }
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
      // Shared: apply repair in memory only (read-only DB). Exclusive: durable
      // first, then memory — crash between COMMIT and push re-repairs on reload.
      events.push(...frozenRepairs);
    }
    sessions.set(id, events);
    touchResident(id);
    return events;
  };

  return {
    create(id = newSessionId()): SessionRecord {
      assertWritable();
      const sid = assertSafeId(id);
      if (sessionIds.has(sid)) {
        throw new Error(`session already exists: ${sid}`);
      }
      sessionIds.add(sid);
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

    append(id: string, event: SessionEvent): SessionEvent {
      assertWritable();
      if (!sessionIds.has(id)) {
        throw new Error(`session not found: ${id}`);
      }
      const events = ensureLoaded(id);
      const parsed = assertSessionEvent(event);
      const frozen = deepFreeze(structuredClone(parsed));
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
            break;
          }
        }
        throw err;
      }
      return frozen;
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
      return {
        lastEventTs: lastEventTsFromDb(db, id),
        hasTurnStart: hasTurnStartInDb(db, id),
        hasCommandRun: hasCommandRunInDb(db, id),
      };
    },

    isLoaded(id: string): boolean {
      return sessions.has(id);
    },

    searchSessionIds(query: string): readonly string[] {
      flushPending();
      const match = ftsMatchQuery(query);
      if (match === '""') return [];
      try {
        const rows = db
          .prepare(
            "SELECT DISTINCT session_id AS id FROM search_fts WHERE search_fts MATCH ?",
          )
          .all(match) as { id: string }[];
        return rows.map((r) => r.id);
      } catch {
        return [];
      }
    },

    flush() {
      flushPending();
    },

    close() {
      try {
        flushPending();
      } finally {
        try {
          db.close();
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

/** Current durable schema version (text-chunks physical packing). */
export const SESSION_SCHEMA_VERSION = SCHEMA_VERSION;
