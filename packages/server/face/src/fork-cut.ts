/**
 * Face session.fork turn-cut: seed is the contiguous prefix through the
 * selected `turn/end` (inclusive). Post-turn inbox / title / model settings
 * stay out of the child.
 */

import {
  contentHasImage,
  type MessageContent,
  type SessionEvent,
} from "@xrkseek/protocol";
import { routeFromRequestHeader } from "./adapt/model-route.js";
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
 * Wire history seq is 1-based (`index + 1`), matching `session.history`.
 * `atSeq` anchors the first `turn/end` at or after that seq; omitted /
 * past-end anchors use the last completed turn. Legacy `beforeSeq` is a raw
 * exclusive offset (no turn mapping) for older callers.
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
      cut: Math.min(beforeSeq, events.length),
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
  let last: FaceModelSelection | undefined;
  for (const event of events) {
    if (event.type !== "request/header") continue;
    const route = routeFromRequestHeader(event);
    if (!route) continue;
    const effort = event.header?.config?.reasoningEffort?.trim();
    last = {
      provider: route.provider,
      model: route.model,
      ...(effort ? { reasoningEffort: effort } : {}),
    };
  }
  return last;
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
