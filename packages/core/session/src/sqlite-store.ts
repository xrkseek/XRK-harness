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
import { repairOpenTurnEvents } from "./repair-open-turn.js";
import { extractEventSearchText } from "./search-text.js";
import type { SessionRecord, SessionListHints, SessionStore } from "./store.js";

function openDatabase(dbPath: string): DatabaseSync {
  const { DatabaseSync: Db } = process.getBuiltinModule(
    "node:sqlite",
  );
  return new Db(dbPath);
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
   * Throws when session is not resident — call after {@link get} or {@link append}.
   */
  eventsRef(id: string): readonly SessionEvent[];
  /** Wire projection eviction when an in-memory log is dropped (LRU). */
  /**
   * Called immediately before an in-memory session log is dropped (LRU).
   * The session is still resident during the callback so `eventsRef` works;
   * Face writes list-tier checkpoints here, then clears projection cells.
   */
  bindSessionEviction(handler: (sessionId: string) => void): void;
}

export interface PersistentSessionStoreOptions {
  /** Max sessions kept resident in memory (default 8). */
  readonly maxResidentSessions?: number;
}

const ID_RE = /^[A-Za-z0-9._-]+$/;
/** v3: durable rows may be packed `text-chunks` / `tool-call-chunks` (expanded on load). */
const SCHEMA_VERSION = 3;
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
  ensureFts(db);

  const current = schemaVersion(db);
  if (current === 0) {
    setSchemaVersion(db, SCHEMA_VERSION);
  } else if (current < SCHEMA_VERSION) {
    rebuildFts(db);
    setSchemaVersion(db, SCHEMA_VERSION);
  }
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
  const root = path.resolve(dir);
  mkdirSync(root, { recursive: true });
  const dbPath = path.join(root, DB_NAME);
  const db = openDatabase(dbPath);
  initSchema(db);

  const sessionIds = loadSessionIds(db);
  const sessions = new Map<string, SessionEvent[]>();
  const residentOrder: string[] = [];
  let onEvict: ((sessionId: string) => void) | undefined;
  const nextSeqBySession = new Map<string, number>();
  let pending: PendingEvent[] = [];

  const touchResident = (id: string): void => {
    const idx = residentOrder.indexOf(id);
    if (idx >= 0) residentOrder.splice(idx, 1);
    residentOrder.push(id);
  };

  const evictResidents = (keepId?: string): void => {
    while (sessions.size >= maxResident) {
      const victim = residentOrder.find((sid) => sid !== keepId);
      if (victim === undefined) break;
      const idx = residentOrder.indexOf(victim);
      if (idx >= 0) residentOrder.splice(idx, 1);
      // Notify while the log is still resident so Face can checkpoint via
      // eventsRef without store.get() re-hydrating the victim (recursion).
      onEvict?.(victim);
      sessions.delete(victim);
    }
  };

  const insertSession = db.prepare("INSERT INTO sessions (id) VALUES (?)");
  const insertEvent = db.prepare(
    "INSERT INTO events (session_id, seq, ts, payload) VALUES (?, ?, ?, ?)",
  );
  const insertFts = db.prepare(
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
    insertEvent.run(sessionId, seq, storageTs(record), JSON.stringify(record));
    const text = extractStorageSearchText(record);
    if (text) insertFts.run(sessionId, seq, text);
  };

  const flushPending = (): void => {
    if (pending.length === 0) return;
    const order: string[] = [];
    const bySession = new Map<string, SessionEvent[]>();
    for (const row of pending) {
      let list = bySession.get(row.sessionId);
      if (!list) {
        list = [];
        bySession.set(row.sessionId, list);
        order.push(row.sessionId);
      }
      list.push(row.event);
    }
    pending = [];
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
      db.exec("ROLLBACK");
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
      for (const ev of repairs) {
        const frozen = deepFreeze(structuredClone(assertSessionEvent(ev)));
        events.push(frozen);
        persistImmediate(id, frozen);
      }
    }
    sessions.set(id, events);
    touchResident(id);
    return events;
  };

  return {
    create(id = newSessionId()): SessionRecord {
      const sid = assertSafeId(id);
      if (sessionIds.has(sid)) {
        throw new Error(`session already exists: ${sid}`);
      }
      sessionIds.add(sid);
      evictResidents(sid);
      sessions.set(sid, []);
      touchResident(sid);
      nextSeqBySession.set(sid, 0);
      insertSession.run(sid);
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
      if (!sessionIds.has(id)) {
        throw new Error(`session not found: ${id}`);
      }
      const events = ensureLoaded(id);
      const parsed = assertSessionEvent(event);
      const frozen = deepFreeze(structuredClone(parsed));
      persistEvent(id, frozen);
      events.push(frozen);
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
        let hasTurnStart = false;
        for (const event of cached) {
          if (event.type === "turn/start") {
            hasTurnStart = true;
            break;
          }
        }
        return {
          lastEventTs: cached[cached.length - 1]?.ts ?? null,
          hasTurnStart,
        };
      }
      return {
        lastEventTs: lastEventTsFromDb(db, id),
        hasTurnStart: hasTurnStartInDb(db, id),
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
      flushPending();
      try {
        db.close();
      } catch {
        /* already closed */
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

    bindSessionEviction(handler: (sessionId: string) => void): void {
      onEvict = handler;
    },
  };
}

/** SQLite database filename under a sessions directory. */
export const SESSION_DB_FILENAME = DB_NAME;

/** Current durable schema version (text-chunks physical packing). */
export const SESSION_SCHEMA_VERSION = SCHEMA_VERSION;
