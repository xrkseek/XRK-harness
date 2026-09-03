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
  readonly hasTurnStart: boolean;
}

export interface SessionStore {
  create(id?: string): SessionRecord;
  get(id: string): SessionRecord;
  /** True if `get(id)` would succeed. */
  has(id: string): boolean;
  append(id: string, event: SessionEvent): SessionEvent;
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
