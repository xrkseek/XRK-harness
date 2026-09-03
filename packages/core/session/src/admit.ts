import { readSessionEvents } from "./seq.js";
import type { SessionEvent, PromptDelivery, MessageContent } from "@xrkseek/protocol";
import { flattenText, isPromptDelivery, mergeMessageContents } from "@xrkseek/protocol";
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
  readonly content: MessageContent;
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

/** Record user text / content blocks without running the model. Ignored by deriveMessages. */
export function admitPrompt(
  store: SessionStore,
  sessionId: string,
  content: MessageContent,
  options?: AdmitPromptOptions,
): AdmitReceipt {
  const empty =
    typeof content === "string"
      ? content.length === 0
      : !Array.isArray(content) || content.length === 0;
  if (empty) {
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
  const pending = listPendingAdmits(readSessionEvents(store, sessionId), sessionId);
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
  const events = readSessionEvents(store, sessionId);
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
  /** Merged user content for `runTurn` (steers joined). */
  readonly content: MessageContent;
  /** Flattened text for assemble / slash (images contribute nothing). */
  readonly text: string;
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
  const pending = listPendingAdmits(readSessionEvents(store, sessionId), sessionId);
  if (!pending.length) throw new NoPendingAdmitError();

  const hasSteer = pending.some((p) => p.delivery === "steer");
  if (!hasSteer) {
    const one = promoteNextAdmit(store, sessionId, options);
    return {
      content: one.content,
      text: flattenText(one.content),
      delivery: "queue",
      receipts: [one],
      steerBatch: false,
    };
  }

  const receipts: AdmitReceipt[] = [];
  for (;;) {
    const still = listPendingAdmits(readSessionEvents(store, sessionId), sessionId);
    const nextSteer = still.find((p) => p.delivery === "steer");
    if (!nextSteer) break;
    receipts.push(promoteNextAdmit(store, sessionId, options));
  }

  const content = mergeMessageContents(receipts.map((r) => r.content));
  return {
    content,
    text: flattenText(content),
    delivery: "steer",
    receipts,
    steerBatch: true,
  };
}

/**
 * Promote pending steers only (leave queues). Used at tool-step boundaries
 * inside an in-flight turn — never promotes queue.
 * Returns undefined when no steers are pending.
 */
export function promotePendingSteers(
  store: SessionStore,
  sessionId: string,
  options?: { readonly now?: () => number },
): PromoteForTurnResult | undefined {
  const pending = listPendingAdmits(readSessionEvents(store, sessionId), sessionId);
  if (!pending.some((p) => p.delivery === "steer")) return undefined;
  return promoteAdmitsForTurn(store, sessionId, options);
}
