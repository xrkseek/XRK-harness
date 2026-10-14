import type { SessionEvent } from "@xrkseek/protocol";

export interface SessionRecord {
  readonly id: string;
  /**
   * Append-only log view. Do not mutate.
   * Memory and persistent stores both reuse the resident array identity for
   * full-range reads; prefer {@link SessionStore.readEvents} / `readSessionEvents`.
   */
  readonly events: readonly SessionEvent[];
}

/** Face `session.list` fast path — avoid loading full logs for cold sessions. */
export interface SessionListHints {
  readonly lastEventTs: number | null;
  /** Agent turn started — session leaves the blank / New Session reuse pool. */
  readonly hasTurnStart: boolean;
  /**
   * Slash command logged (`command/run`) — also leaves blank so Hero can show
   * the durable command card without waiting for a turn.
   */
  readonly hasCommandRun: boolean;
}

export interface SessionStore {
  create(id?: string): SessionRecord;
  get(id: string): SessionRecord;
  /** True if `get(id)` would succeed. */
  has(id: string): boolean;
  append(id: string, event: SessionEvent): SessionEvent;
  /**
   * Create a session whose log is the given prefix in one shot (fork / restore).
   * Prefer over create+append loops so durable stores can commit once and Face
   * can skip per-event mux during seed. Optional on lightweight test doubles —
   * {@link forkSession} falls back to append when absent.
   */
  seed?(id: string | undefined, events: readonly SessionEvent[]): SessionRecord;
  /**
   * Replace an existing session's log with `events` (same id). Used by
   * Cursor-style edit/delete truncate — not fork. Optional on lightweight
   * test doubles.
   */
  replacePrefix?(id: string, events: readonly SessionEvent[]): SessionRecord;
  /**
   * Permanently drop one session log (memory and durable rows when present,
   * including cold archive rows). Idempotent for an unknown id. Optional on
   * lightweight test doubles. File shrink needs {@link reclaimStorage} / close.
   */
  delete?(id: string): void;
  /**
   * Best-effort reclaim of freelist pages in a durable store (VACUUM when the
   * free share is large enough). No-op / false for memory stores. Optional.
   */
  reclaimStorage?(): boolean;
  /**
   * Move a durable session log into the cold archive DB (lighten hot
   * `sessions.db`). Idempotent when already offloaded. Optional — memory
   * stores omit this (archive is registry-only).
   */
  offloadToArchive?(id: string): void;
  /**
   * Move a cold archive log back into the hot DB. Idempotent when already hot.
   */
  restoreFromArchive?(id: string): void;
  /** True when the durable log sits in the archive DB. */
  isOffloaded?(id: string): boolean;
  list(): readonly string[];
  /**
   * Half-open event range `[fromSeq, toSeqExclusive)`.
   * Full-range hits reuse the resident array identity.
   * Persistent cold miss hydrates once (packed rows expand in memory —
   * disk-level event-index range IO is not available while storage packs chunks).
   */
  readEvents(
    id: string,
    fromSeq?: number,
    toSeqExclusive?: number,
  ): readonly SessionEvent[];
  /**
   * Sidebar metadata without hydrating the full event log (list fast path).
   * Omit on lightweight test doubles.
   */
  listHints?(id: string): SessionListHints;
  /** True when the full log is already resident (optional). */
  isLoaded?(id: string): boolean;
}
