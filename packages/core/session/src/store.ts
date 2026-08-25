import type { SessionEvent } from "@xrkseek/protocol";

export interface SessionRecord {
  readonly id: string;
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
   * Sidebar metadata without hydrating the full event log (DSH list fast path).
   * Omit on lightweight test doubles.
   */
  listHints?(id: string): SessionListHints;
  /** True when the full log is already resident (optional). */
  isLoaded?(id: string): boolean;
}
