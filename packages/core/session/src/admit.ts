import { readSessionEvents } from "./seq.js";
import type {
  SessionEvent,
  PromptDelivery,
  MessageContent,
  UserMessageSource,
} from "@xrkseek/protocol";
import {
  flattenText,
  isAdmitSpeechUserMessageSource,
  isHumanUserMessageSource,
  isPromptDelivery,
  mergeMessageContents,
} from "@xrkseek/protocol";
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
  /** Client submission echo id when stamped on `prompt/admitted`. */
  readonly rpcId?: string;
  /** Durable producer; stamped onto `user/message.source` on promote when set. */
  readonly source?: UserMessageSource;
}

export interface AdmitPromptOptions {
  readonly admitId?: string;
  readonly now?: () => number;
  /** Default `"queue"`. Persisted on the event only when `"steer"` (keep logs lean). */
  readonly delivery?: PromptDelivery;
  /** Client echo id; survives Host restart via the session log. */
  readonly rpcId?: string;
  /**
   * Durable producer of this admit (plugin notices, …). Persisted on
   * `prompt/admitted` and copied onto `user/message` when promoted.
   */
  readonly source?: UserMessageSource;
}

/**
 * Source to stamp on the promoted `user/message`. Prefers the first non-human
 * producer when steers coalesce; otherwise the first receipt's source (or
 * undefined → caller defaults to `{ kind: "user" }`).
 */
export function promotedUserMessageSource(
  receipts: readonly AdmitReceipt[],
): UserMessageSource | undefined {
  if (receipts.length === 0) return undefined;
  for (const r of receipts) {
    if (r.source !== undefined && !isHumanUserMessageSource(r.source)) {
      return r.source;
    }
  }
  return receipts[0]?.source;
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
  const rpcId =
    typeof options?.rpcId === "string" && options.rpcId.trim().length > 0
      ? options.rpcId.trim()
      : undefined;
  const source = options?.source;
  store.append(sessionId, {
    type: "prompt/admitted",
    ts: now(),
    admitId,
    content,
    ...(delivery === "steer" ? { delivery: "steer" as const } : {}),
    ...(rpcId !== undefined ? { rpcId } : {}),
    ...(source !== undefined ? { source } : {}),
  });
  return {
    admitId,
    sessionId,
    content,
    delivery,
    ...(rpcId !== undefined ? { rpcId } : {}),
    ...(source !== undefined ? { source } : {}),
  };
}

/**
 * Pending admits in FIFO order.
 *
 * Chronological fold: each `prompt/admitted` opens (or replaces) a row;
 * `prompt/promoted` / `prompt/withdrawn` close it. A later admit with the same
 * id after withdraw is pending again — required for queue edit/steer rewrite
 * that keeps stable admitIds. The old "closed forever" scan rejected re-admits
 * and forced rewrite to mint new ids + remap rpc tables.
 */
export function listPendingAdmits(
  events: readonly SessionEvent[],
  sessionId = "",
): readonly AdmitReceipt[] {
  const order: string[] = [];
  const open = new Map<string, AdmitReceipt>();
  for (const ev of events) {
    if (ev.type === "prompt/admitted") {
      const receipt: AdmitReceipt = {
        admitId: ev.admitId,
        sessionId,
        content: ev.content,
        delivery: effectiveDelivery(ev.delivery),
        ...(typeof ev.rpcId === "string" && ev.rpcId.length > 0
          ? { rpcId: ev.rpcId }
          : {}),
        ...(ev.source !== undefined ? { source: ev.source } : {}),
      };
      if (!open.has(ev.admitId)) order.push(ev.admitId);
      open.set(ev.admitId, receipt);
      continue;
    }
    if (ev.type === "prompt/promoted" || ev.type === "prompt/withdrawn") {
      if (!open.delete(ev.admitId)) continue;
      const at = order.indexOf(ev.admitId);
      if (at >= 0) order.splice(at, 1);
    }
  }
  return order.map((id) => open.get(id)!);
}

/**
 * Session ids that still have pending Inbox rows (queue or steer).
 * Used after Host restart to republish / wake without a separate inbox table.
 */
export function listSessionsWithPendingAdmits(
  store: SessionStore,
): readonly string[] {
  const out: string[] = [];
  for (const sessionId of store.list()) {
    if (
      listPendingAdmits(readSessionEvents(store, sessionId), sessionId).length >
      0
    ) {
      out.push(sessionId);
    }
  }
  return out;
}

/**
 * True when this session has at least one pending **steer** (not queue).
 * Wait-class tools (`wait_agent`, peer sync wait) poll this so a human
 * 插队 can soft-yield the wait without `session.cancel`.
 */
export function sessionHasPendingSteer(
  store: SessionStore,
  sessionId: string,
): boolean {
  return listPendingAdmits(
    readSessionEvents(store, sessionId),
    sessionId,
  ).some((p) => p.delivery === "steer");
}

/**
 * `prompt/promoted` rows after the latest admit-speech `user/message` — crash
 * window between promote and the Face-stamped user row (`beforeUserMessage`
 * await). Seat / handoff / plugin steers close the window the same as human
 * speech; durable injects (skill-catalog / …) do not. Content is still on the
 * matching `prompt/admitted`; not model-visible yet.
 */
export function listDanglingPromotedAdmits(
  events: readonly SessionEvent[],
  sessionId = "",
): readonly AdmitReceipt[] {
  let lastSpeech = -1;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (
      ev !== undefined
      && ev.type === "user/message"
      && isAdmitSpeechUserMessageSource(ev.source)
    ) {
      lastSpeech = i;
    }
  }
  const promotedIds: string[] = [];
  const seen = new Set<string>();
  for (let i = lastSpeech + 1; i < events.length; i++) {
    const ev = events[i];
    if (ev?.type !== "prompt/promoted") continue;
    if (seen.has(ev.admitId)) continue;
    seen.add(ev.admitId);
    promotedIds.push(ev.admitId);
  }
  if (promotedIds.length === 0) return [];

  const byAdmit = new Map<string, AdmitReceipt>();
  for (const ev of events) {
    if (ev.type !== "prompt/admitted") continue;
    byAdmit.set(ev.admitId, {
      admitId: ev.admitId,
      sessionId,
      content: ev.content,
      delivery: effectiveDelivery(ev.delivery),
      ...(typeof ev.rpcId === "string" && ev.rpcId.length > 0
        ? { rpcId: ev.rpcId }
        : {}),
      ...(ev.source !== undefined ? { source: ev.source } : {}),
    });
  }
  const out: AdmitReceipt[] = [];
  for (const id of promotedIds) {
    const row = byAdmit.get(id);
    if (row !== undefined) out.push(row);
  }
  return out;
}

/**
 * Sessions that need Inbox recover after Host restart: pending admits and/or
 * dangling promotes (promoted, user/message not yet written).
 *
 * Prefers {@link SessionStore.readInboxRecoverEvents} when present so durable
 * stores can skip full-log hydrate + LRU thrash across hundreds of sessions.
 */
export function listSessionsNeedingInboxRecover(
  store: SessionStore,
): readonly string[] {
  const out: string[] = [];
  const peek = store.readInboxRecoverEvents?.bind(store);
  for (const sessionId of store.list()) {
    const events = peek
      ? peek(sessionId)
      : readSessionEvents(store, sessionId);
    if (listPendingAdmits(events, sessionId).length > 0) {
      out.push(sessionId);
      continue;
    }
    if (listDanglingPromotedAdmits(events, sessionId).length > 0) {
      out.push(sessionId);
    }
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

/**
 * Turn input recovered from dangling promotes (same merge rules as
 * {@link promoteAdmitsForTurn}). Caller must not promote again.
 */
export function danglingPromotesForTurn(
  events: readonly SessionEvent[],
  sessionId = "",
): PromoteForTurnResult | undefined {
  const receipts = listDanglingPromotedAdmits(events, sessionId);
  if (receipts.length === 0) return undefined;
  const hasSteer = receipts.some((p) => p.delivery === "steer");
  if (!hasSteer) {
    const one = receipts[0];
    if (one === undefined) return undefined;
    return {
      content: one.content,
      text: flattenText(one.content),
      delivery: "queue",
      receipts: [one],
      steerBatch: false,
    };
  }
  const steers = receipts.filter((p) => p.delivery === "steer");
  const content = mergeMessageContents(steers.map((r) => r.content));
  return {
    content,
    text: flattenText(content),
    delivery: "steer",
    receipts: steers,
    steerBatch: true,
  };
}

/**
 * Resolve the next turn's user content from the inbox SoT.
 *
 * Order matters for Host-restart crash windows:
 * 1. **Dangling queue** (`prompt/promoted`, no human `user/message`) — finish
 *    that one queue turn; do not also promote newer pending rows.
 * 2. **Dangling steers** — merge with any still-pending steers (mid-batch
 *    crash); leave queues pending.
 * 3. Else {@link promoteAdmitsForTurn} (unchanged hot path).
 */
export function resolveAdmitsForTurn(
  store: SessionStore,
  sessionId: string,
  options?: { readonly now?: () => number },
): PromoteForTurnResult {
  const events = readSessionEvents(store, sessionId);
  const dangling = danglingPromotesForTurn(events, sessionId);
  if (dangling !== undefined && !dangling.steerBatch) {
    return dangling;
  }
  if (dangling !== undefined && dangling.steerBatch) {
    const more = promotePendingSteers(store, sessionId, options);
    if (more === undefined) return dangling;
    const receipts = [...dangling.receipts, ...more.receipts];
    const content = mergeMessageContents(receipts.map((r) => r.content));
    return {
      content,
      text: flattenText(content),
      delivery: "steer",
      receipts,
      steerBatch: true,
    };
  }
  return promoteAdmitsForTurn(store, sessionId, options);
}

/** Pending admits or dangling promotes — drain must not exit while either remains. */
export function sessionHasInboxWork(
  events: readonly SessionEvent[],
  sessionId = "",
): boolean {
  return (
    listPendingAdmits(events, sessionId).length > 0
    || listDanglingPromotedAdmits(events, sessionId).length > 0
  );
}
