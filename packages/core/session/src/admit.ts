import type { SessionEvent, PromptDelivery } from "@xrkseek/protocol";
import { isPromptDelivery } from "@xrkseek/protocol";
import type { SessionRecord, SessionStore } from "./index.js";

/**
 * Admit / promote — inbox for user text that is not yet model-visible.
 *
 * Product: docs/session-delivery.md
 * - default delivery = queue (FIFO)
 * - steer promotes ahead of older queue entries
 */
export class NoPendingAdmitError extends Error {
  constructor(message = "no pending admit to promote") {
    super(message);
    this.name = "NoPendingAdmitError";
  }
}

export interface AdmitReceipt {
  readonly admitId: string;
  readonly sessionId: string;
  readonly content: string;
  /** Effective delivery; omitted event field and `"queue"` both surface as `"queue"`. */
  readonly delivery: PromptDelivery;
}

export interface AdmitPromptOptions {
  readonly admitId?: string;
  readonly now?: () => number;
  /** Default `"queue"`. Persisted on the event only when `"steer"` (keep logs lean). */
  readonly delivery?: PromptDelivery;
}

function newAdmitId(): string {
  return `admit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function effectiveDelivery(value: PromptDelivery | undefined): PromptDelivery {
  return value === "steer" ? "steer" : "queue";
}

/**
 * Create or reuse a session log (product: newSession).
 * Existing id → return as-is; missing id → create.
 */
export function newSession(store: SessionStore, id?: string): SessionRecord {
  if (id) {
    try {
      return store.get(id);
    } catch {
      return store.create(id);
    }
  }
  return store.create();
}

/** Record user text without running the model. Ignored by deriveMessages. */
export function admitPrompt(
  store: SessionStore,
  sessionId: string,
  content: string,
  options?: AdmitPromptOptions,
): AdmitReceipt {
  if (!content || typeof content !== "string") {
    throw new Error("admit content required");
  }
  if (
    options?.delivery !== undefined &&
    !isPromptDelivery(options.delivery)
  ) {
    throw new Error(`invalid delivery: ${String(options.delivery)}`);
  }
  const admitId = options?.admitId ?? newAdmitId();
  const now = options?.now ?? Date.now;
  const delivery = effectiveDelivery(options?.delivery);
  store.append(sessionId, {
    type: "prompt/admitted",
    ts: now(),
    admitId,
    content,
    ...(delivery === "steer" ? { delivery: "steer" as const } : {}),
  });
  return { admitId, sessionId, content, delivery };
}

/** Pending admits in FIFO order (admitted without later promoted/withdrawn). */
export function listPendingAdmits(
  events: readonly SessionEvent[],
  sessionId = "",
): readonly AdmitReceipt[] {
  const closed = new Set<string>();
  for (const ev of events) {
    if (ev.type === "prompt/promoted" || ev.type === "prompt/withdrawn") {
      closed.add(ev.admitId);
    }
  }
  const out: AdmitReceipt[] = [];
  const seen = new Set<string>();
  for (const ev of events) {
    if (ev.type !== "prompt/admitted") continue;
    if (closed.has(ev.admitId) || seen.has(ev.admitId)) continue;
    seen.add(ev.admitId);
    out.push({
      admitId: ev.admitId,
      sessionId,
      content: ev.content,
      delivery: effectiveDelivery(ev.delivery),
    });
  }
  return out;
}

export class AdmitNotPendingError extends Error {
  constructor(admitId: string) {
    super(`admit not pending: ${admitId}`);
    this.name = "AdmitNotPendingError";
  }
}

/** Withdraw one pending admit (inbox remove / rewrite). */
export function withdrawAdmit(
  store: SessionStore,
  sessionId: string,
  admitId: string,
  options?: { readonly now?: () => number },
): void {
  const pending = listPendingAdmits(store.get(sessionId).events, sessionId);
  if (!pending.some((p) => p.admitId === admitId)) {
    throw new AdmitNotPendingError(admitId);
  }
  const now = options?.now ?? Date.now;
  store.append(sessionId, {
    type: "prompt/withdrawn",
    ts: now(),
    admitId,
  });
}

/**
 * Promote next pending admit (append prompt/promoted).
 * Prefers oldest **steer**, else oldest **queue** (docs/session-delivery.md).
 * Does not append user/message — caller passes content into continueTurn/runTurn.
 */
export function promoteNextAdmit(
  store: SessionStore,
  sessionId: string,
  options?: { readonly now?: () => number },
): AdmitReceipt {
  const events = store.get(sessionId).events;
  const pending = listPendingAdmits(events, sessionId);
  const next =
    pending.find((p) => p.delivery === "steer") ?? pending[0];
  if (!next) throw new NoPendingAdmitError();
  const now = options?.now ?? Date.now;
  store.append(sessionId, {
    type: "prompt/promoted",
    ts: now(),
    admitId: next.admitId,
  });
  return next;
}

export interface PromoteForTurnResult {
  /** Merged user text for `runTurn` (steers joined with blank lines). */
  readonly content: string;
  readonly delivery: PromptDelivery;
  readonly receipts: readonly AdmitReceipt[];
  /**
   * True when one or more steers were promoted in this call.
   * One `runTurn` = one step-quota reset for the whole batch.
   */
  readonly steerBatch: boolean;
}

/**
 * Promote admits for a single continueTurn / drain step.
 *
 * - **queue**: promote exactly one (unchanged §3).
 * - **steer**: promote **all** currently pending steers (FIFO among steers),
 *   merge contents — one turn, one maxSteps budget (session-delivery §3).
 *   Queues stay pending.
 */
export function promoteAdmitsForTurn(
  store: SessionStore,
  sessionId: string,
  options?: { readonly now?: () => number },
): PromoteForTurnResult {
  const pending = listPendingAdmits(store.get(sessionId).events, sessionId);
  if (!pending.length) throw new NoPendingAdmitError();

  const hasSteer = pending.some((p) => p.delivery === "steer");
  if (!hasSteer) {
    const one = promoteNextAdmit(store, sessionId, options);
    return {
      content: one.content,
      delivery: "queue",
      receipts: [one],
      steerBatch: false,
    };
  }

  const receipts: AdmitReceipt[] = [];
  for (;;) {
    const still = listPendingAdmits(store.get(sessionId).events, sessionId);
    const nextSteer = still.find((p) => p.delivery === "steer");
    if (!nextSteer) break;
    receipts.push(promoteNextAdmit(store, sessionId, options));
  }

  return {
    content: receipts.map((r) => r.content).join("\n\n"),
    delivery: "steer",
    receipts,
    steerBatch: true,
  };
}
