import type { SessionEvent } from "@xrkseek/protocol";
import type { SessionStore } from "@xrkseek/core-session";
import { opsRecord, recordFromSessionEvent } from "./record.js";
import {
  applyRedaction,
  basicRedactionRule,
  type RedactionRule,
} from "./redact.js";
import type { SessionTelemetrySink } from "./types.js";

export interface WrapStoreForSessionTelemetryOptions {
  readonly store: SessionStore;
  readonly sink: SessionTelemetrySink;
  /** When set, only this sessionId is exported (composition-scoped). */
  readonly sessionId?: string;
  /**
   * Redaction waterfall applied before `sink.emit`.
   * Default: `[basicRedactionRule]` (strip prompt/tool payload text).
   * Pass `[]` to disable (tests / trusted memory sink only).
   */
  readonly redactionRules?: readonly RedactionRule[];
}

/**
 * Live capture: mirror each append into the telemetry sink (non-blocking).
 * Never throws to the agent loop — sink/record failures are contained.
 */
export function wrapStoreForSessionTelemetry(
  options: WrapStoreForSessionTelemetryOptions,
): SessionStore {
  const { store, sink } = options;
  const redactionRules = options.redactionRules ?? [basicRedactionRule];

  /**
   * Mirror one optional store verb only when the wrapped store has it.
   *
   * Face gates `session.truncate` on `typeof store.replacePrefix === 'function'`
   * and archived-session deletion on `store.delete`, so a wrapper that drops
   * them turns every edit / delete / regenerate into `truncate-unsupported`
   * the moment telemetry is switched on. Spreading the verb keeps the
   * "absent means unsupported" contract instead of faking it with a stub.
   */
  const forwardOptional = <K extends keyof SessionStore>(
    key: K,
  ): Partial<Pick<SessionStore, K>> => {
    const fn = store[key];
    if (typeof fn !== "function") return {};
    // Computed-key object is wider than Partial<Pick<…>>; assert at the return.
    return {
      [key]: fn.bind(store),
    } as Partial<Pick<SessionStore, K>>;
  };

  const emitFor = (id: string, event: SessionEvent, seq: number): void => {
    if (options.sessionId !== undefined && id !== options.sessionId) return;
    try {
      const raw = recordFromSessionEvent(id, event, seq);
      const redacted = applyRedaction(raw, redactionRules);
      if (!redacted) return;
      sink.emit(redacted);
      if (event.type === "turn/end") {
        sink.flush?.();
      }
    } catch {
      /* never reach the loop */
    }
  };

  return {
    ...forwardOptional("seed"),
    ...forwardOptional("seedFromSession"),
    ...forwardOptional("replacePrefix"),
    ...forwardOptional("delete"),
    ...forwardOptional("reclaimStorage"),
    ...forwardOptional("offloadToArchive"),
    ...forwardOptional("restoreFromArchive"),
    ...forwardOptional("isOffloaded"),
    ...forwardOptional("listHints"),
    ...forwardOptional("isLoaded"),
    ...forwardOptional("readEventsTail"),
    ...forwardOptional("scanDurableSingles"),
    ...forwardOptional("flush"),
    ...forwardOptional("releaseResident"),
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
    append(id, event) {
      const logged = store.append(id, event);
      // Face seq = 1-based index in full log (same clock as session.history).
      const seq = store.readEvents(id).length;
      emitFor(id, logged, seq);
      return logged;
    },
  };
}
