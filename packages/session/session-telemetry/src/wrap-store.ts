import type { SessionEvent } from "@xrkseek/protocol";
import type { SessionStore } from "@xrkseek/core-session";
import { opsRecord, recordFromSessionEvent } from "./record.js";
import type { SessionTelemetrySink } from "./types.js";

export interface WrapStoreForSessionTelemetryOptions {
  readonly store: SessionStore;
  readonly sink: SessionTelemetrySink;
  /** When set, only this sessionId is exported (composition-scoped). */
  readonly sessionId?: string;
}

/**
 * Live capture: mirror each append into the telemetry sink (non-blocking).
 * Never throws to the agent loop — sink/record failures are contained.
 */
export function wrapStoreForSessionTelemetry(
  options: WrapStoreForSessionTelemetryOptions,
): SessionStore {
  const { store, sink } = options;
  const seqBySession = new Map<string, number>();

  const emitFor = (id: string, event: SessionEvent): void => {
    if (options.sessionId !== undefined && id !== options.sessionId) return;
    try {
      const next = (seqBySession.get(id) ?? 0) + 1;
      seqBySession.set(id, next);
      sink.emit(recordFromSessionEvent(id, event, next));
      if (event.type === "turn/end") {
        sink.flush?.();
      }
    } catch {
      /* never reach the loop */
    }
  };

  return {
    create: (id) => {
      const rec = store.create(id);
      try {
        sink.emit(opsRecord(rec.id, "session.created"));
      } catch {
        /* ignore */
      }
      return rec;
    },
    get: (id) => store.get(id),
    has: (id) => store.has(id),
    list: () => store.list(),
    readEvents: (id, from, to) => store.readEvents(id, from, to),
    ...(store.listHints
      ? { listHints: (id: string) => store.listHints!(id) }
      : {}),
    ...(store.isLoaded
      ? { isLoaded: (id: string) => store.isLoaded!(id) }
      : {}),
    append(id, event) {
      const logged = store.append(id, event);
      emitFor(id, logged);
      return logged;
    },
  };
}
