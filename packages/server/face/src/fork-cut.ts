/**
 * Face session.fork turn-cut: seed is the contiguous prefix through the
 * selected `turn/end` (inclusive). Post-turn inbox / title / model settings
 * stay out of the child.
 */

import {
  contentHasImage,
  isHumanUserMessageSource,
  type MessageContent,
  type SessionEvent,
} from "@xrkseek/protocol";
import { lastRequestHeaderSelection } from "./adapt/model-route.js";
import type { FaceModelSelection } from "./model-catalog.js";

export type ForkCutOk = {
  readonly ok: true;
  /** Exclusive end index into the durable log (`events.slice(0, cut)`). */
  readonly cut: number;
  readonly atSeq?: number;
  readonly beforeSeq?: number;
};

export type ForkCutFail = {
  readonly ok: false;
  readonly code: "fork-unavailable" | "invalid-payload";
  readonly message: string;
};

/**
 * Exclusive `beforeSeq` cut, then drop a trailing open / human-less turn.
 * Edit-resubmit uses `beforeSeq = userSeq - 1`; `turn/start` sits before the
 * user row, so a raw offset would seed an open turn and the child's next
 * prompt would `repairOpenTurn` it into a ghost 「已停止」.
 */
function trimBeforeSeqCut(
  events: readonly SessionEvent[],
  rawCut: number,
): number {
  const end = Math.min(Math.max(0, rawCut), events.length);
  type TurnAcc = {
    start: number;
    end?: number;
    hasHuman: boolean;
    started: boolean;
  };
  const byId = new Map<string, TurnAcc>();
  const order: string[] = [];
  const accFor = (turnId: string, index: number): TurnAcc => {
    let acc = byId.get(turnId);
    if (acc === undefined) {
      acc = { start: index, hasHuman: false, started: false };
      byId.set(turnId, acc);
      order.push(turnId);
    }
    return acc;
  };
  for (let i = 0; i < end; i++) {
    const event = events[i];
    if (event === undefined || !("turnId" in event)) continue;
    const turnId = event.turnId;
    if (typeof turnId !== "string" || turnId.length === 0) continue;
    const acc = accFor(turnId, i);
    if (event.type === "turn/start") {
      acc.started = true;
      acc.start = i;
    }
    if (
      event.type === "user/message" &&
      isHumanUserMessageSource(event.source)
    ) {
      acc.hasHuman = true;
    }
    if (event.type === "turn/end") acc.end = i;
  }

  let cut = 0;
  let sawStart = false;
  for (const turnId of order) {
    const acc = byId.get(turnId);
    if (acc === undefined || !acc.started) continue;
    sawStart = true;
    if (acc.end === undefined || !acc.hasHuman) return acc.start;
    cut = acc.end + 1;
  }
  return sawStart ? cut : end;
}

/**
 * Wire history seq is 1-based (`index + 1`), matching `session.history`.
 * `atSeq` anchors the first `turn/end` at or after that seq; omitted /
 * past-end anchors use the last completed turn. `beforeSeq` is an exclusive
 * offset; the seed then keeps only completed turns that contain a human
 * `user/message` (open / abort-only turns stay out).
 */
export function resolveForkCut(
  events: readonly SessionEvent[],
  opts: { readonly atSeq?: number; readonly beforeSeq?: number },
): ForkCutOk | ForkCutFail {
  const atSeq = opts.atSeq;
  const beforeSeq = opts.beforeSeq;

  if (atSeq !== undefined) {
    if (!Number.isSafeInteger(atSeq) || atSeq < 1 || Object.is(atSeq, -0)) {
      return {
        ok: false,
        code: "invalid-payload",
        message: "atSeq must be a positive safe integer (1-based Face seq)",
      };
    }
  }
  if (beforeSeq !== undefined) {
    if (
      !Number.isSafeInteger(beforeSeq) ||
      beforeSeq < 0 ||
      Object.is(beforeSeq, -0)
    ) {
      return {
        ok: false,
        code: "invalid-payload",
        message: "beforeSeq must be a non-negative safe integer",
      };
    }
  }

  // Prefer turn-cut when the client sends atSeq (product shell / DSH bridge).
  if (atSeq === undefined && beforeSeq !== undefined) {
    return {
      ok: true,
      cut: trimBeforeSeqCut(events, beforeSeq),
      beforeSeq,
    };
  }

  const lastWireSeq = events.length;
  let endIndex = -1;
  if (atSeq === undefined) {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]!.type === "turn/end") {
        endIndex = i;
        break;
      }
    }
  } else {
    for (let i = 0; i < events.length; i++) {
      if (events[i]!.type === "turn/end" && i + 1 >= atSeq) {
        endIndex = i;
        break;
      }
    }
    if (endIndex < 0 && atSeq > lastWireSeq) {
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i]!.type === "turn/end") {
          endIndex = i;
          break;
        }
      }
    }
  }

  if (endIndex < 0) {
    return {
      ok: false,
      code: "fork-unavailable",
      message:
        atSeq !== undefined && atSeq <= lastWireSeq
          ? `session has not completed the turn containing event ${String(atSeq)}`
          : "session has no completed turn to fork from",
    };
  }

  return {
    ok: true,
    cut: endIndex + 1,
    ...(atSeq !== undefined ? { atSeq } : {}),
  };
}

/** Latest `request/header` route inside the seed prefix (ignores live Face maps). */
export function modelSelectionFromPrefix(
  events: readonly SessionEvent[],
): FaceModelSelection | undefined {
  return lastRequestHeaderSelection(events);
}

export function prefixHasImageContent(
  events: readonly SessionEvent[],
): boolean {
  for (const ev of events) {
    if (ev.type !== "user/message" && ev.type !== "prompt/admitted") continue;
    const content = (ev as { content?: MessageContent }).content;
    if (content !== undefined && contentHasImage(content)) return true;
  }
  return false;
}
