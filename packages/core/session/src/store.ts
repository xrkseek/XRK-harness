import type { SessionEvent } from "@xrkseek/protocol";

export interface SessionRecord {
  readonly id: string;
  readonly events: readonly SessionEvent[];
}

export interface SessionStore {
  create(id?: string): SessionRecord;
  get(id: string): SessionRecord;
  /** True if `get(id)` would succeed. */
  has(id: string): boolean;
  append(id: string, event: SessionEvent): SessionEvent;
  list(): readonly string[];
}
