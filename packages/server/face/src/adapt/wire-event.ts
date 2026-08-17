/**
 * XRK SessionEvent → Face mux/history wire row.
 *
 * DeepSeek Web expects `{ type, seq, time, data }` with seq inside the event.
 * turn/step use session-scoped monotonic maps when provided (preferred);
 * otherwise fall back to wireNumericId hash for isolated unit tests.
 */

import type { SessionEvent } from "@xrkseek/protocol";
import {
  FaceInboxWireProjector,
  type DshInboxSplice,
} from "./inbox-wire.js";
import { presentToolView, type ToolEventView } from "./tool-view.js";
import type { FaceWireIdMaps } from "./wire-ids.js";

/** Published isomorphism keys (XRK type → wire role). */
export const EVENT_ISOMORPHISM = {
  "user/message": "user",
  "assistant/chunk": "assistant.delta",
  "assistant/message": "assistant.message",
  "tool/call": "tool.call",
  "tool/result": "tool.result",
  "turn/start": "turn.start",
  "turn/end": "turn.end",
  "step/start": "step.start",
  "step/end": "step.end",
  "prompt/admitted": "agent/inbox/spliced",
  "prompt/promoted": "agent/inbox/spliced",
  "prompt/withdrawn": "agent/inbox/spliced",
  "safety/notice": "safety",
  "context/compaction": "compaction",
  "session/title": "title",
  "approval/asked": "approval.asked",
  "approval/decided": "approval.decided",
} as const satisfies Record<SessionEvent["type"], string>;

/** DeepSeek SessionEvent envelope on the Face wire. */
export interface DshWireSessionEvent {
  readonly type: string;
  readonly seq: number;
  readonly time: number;
  readonly data: unknown;
  /** When true, DSH client fold may skip unknown / non-product events. */
  readonly ignorable?: true;
}

export interface WireHistoryEntry {
  readonly event: DshWireSessionEvent;
  readonly view?: ToolEventView;
}

export interface WireAdaptContext {
  readonly sessionId: string;
  readonly ids?: FaceWireIdMaps;
  /**
   * Ordered inbox projector. Required for prompt/* → `agent/inbox/spliced`.
   * History builds a fresh projector; mux reuses the per-session instance.
   */
  readonly inbox?: FaceInboxWireProjector;
}

function textBlocks(text: string): readonly { type: "text"; text: string }[] {
  return [{ type: "text", text }];
}

/**
 * Fallback when no FaceWireIdMaps (unit tests). Prefer maps in production path.
 */
export function wireNumericId(id: string): number {
  const asNum = Number(id);
  if (Number.isFinite(asNum) && asNum >= 0 && String(asNum) === id) {
    return asNum;
  }
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 1_000_000_000 || 1;
}

function turnNum(
  ctx: WireAdaptContext | undefined,
  turnId: string,
): number {
  if (ctx?.ids) return ctx.ids.turn(ctx.sessionId, turnId);
  return wireNumericId(turnId);
}

function stepNum(
  ctx: WireAdaptContext | undefined,
  turnId: string,
  stepId: string,
): number {
  if (ctx?.ids) return ctx.ids.step(ctx.sessionId, turnId, stepId);
  return wireNumericId(stepId);
}

function assistantMessageContent(
  event: Extract<SessionEvent, { type: "assistant/message" }>,
): unknown[] {
  const blocks: unknown[] = [...textBlocks(event.content)];
  for (const call of event.toolCalls ?? []) {
    let argsRaw: string;
    try {
      argsRaw =
        typeof call.arguments === "string"
          ? call.arguments
          : JSON.stringify(call.arguments ?? {});
    } catch {
      argsRaw = "{}";
    }
    blocks.push({
      type: "tool-call",
      id: call.id,
      name: call.name,
      arguments: argsRaw,
    });
  }
  return blocks;
}

/** Map XRK flat event → DSH `{ type, seq, time, data }`. */
export function toDshWireSessionEvent(
  event: SessionEvent,
  seq: number,
  ctx?: WireAdaptContext,
): DshWireSessionEvent {
  const time = event.ts;
  switch (event.type) {
    case "user/message":
      return {
        type: "user/message",
        seq,
        time,
        data: {
          id: event.turnId,
          content: textBlocks(event.content),
          source: { kind: "user" },
          ...(event.rpcId ? { rpcId: event.rpcId } : {}),
        },
      };
    case "assistant/chunk":
      return {
        type: "assistant/chunk",
        seq,
        time,
        data: {
          turn: turnNum(ctx, event.turnId),
          step: stepNum(ctx, event.turnId, event.stepId),
          chunk: { type: "text-delta", index: 0, text: event.text },
        },
      };
    case "assistant/message":
      return {
        type: "assistant/message",
        seq,
        time,
        data: {
          turn: turnNum(ctx, event.turnId),
          step: stepNum(ctx, event.turnId, event.stepId),
          message: {
            id: `${event.turnId}:${event.stepId}`,
            content: assistantMessageContent(event),
            source: { provider: "xrk", model: "unknown" },
          },
        },
      };
    case "turn/start":
    case "turn/end":
      return {
        type: event.type,
        seq,
        time,
        data: { turn: turnNum(ctx, event.turnId) },
      };
    case "step/start":
    case "step/end":
      return {
        type: event.type,
        seq,
        time,
        data: {
          turn: turnNum(ctx, event.turnId),
          step: stepNum(ctx, event.turnId, event.stepId),
        },
      };
    case "tool/call":
      return {
        type: "tool/call",
        seq,
        time,
        data: {
          callId: event.call.id,
          name: event.call.name,
          arguments: event.call.arguments ?? {},
          turn: turnNum(ctx, event.turnId),
          step: stepNum(ctx, event.turnId, event.stepId),
        },
      };
    case "tool/result":
      return {
        type: "tool/result",
        seq,
        time,
        data: {
          turn: turnNum(ctx, event.turnId),
          step: stepNum(ctx, event.turnId, event.stepId),
          message: {
            content: [
              {
                content: textBlocks(event.result.content),
                ...(event.result.isError ? { isError: true } : {}),
              },
            ],
            source: { callId: event.result.toolCallId },
          },
          ...(event.result.isError
            ? { error: { message: event.result.content } }
            : {}),
        },
      };
    case "session/title":
      return {
        type: "session/title",
        seq,
        time,
        data: {
          title: event.title,
          messageSeqs: event.messageSeqs,
          source: event.source,
        },
      };
    case "prompt/admitted":
    case "prompt/promoted":
    case "prompt/withdrawn": {
      const splice: DshInboxSplice | undefined = ctx?.inbox?.project(event);
      if (splice) {
        return {
          type: "agent/inbox/spliced",
          seq,
          time,
          data: splice,
        };
      }
      // No projector (isolated unit call) — keep XRK type, mark skippable.
      return {
        type: event.type,
        seq,
        time,
        data: stripBase(event),
        ignorable: true,
      };
    }
    case "safety/notice":
    case "context/compaction":
    case "approval/asked":
    case "approval/decided":
      return {
        type: event.type,
        seq,
        time,
        data: stripBase(event),
        ignorable: true,
      };
  }
}

function stripBase(event: SessionEvent): Record<string, unknown> {
  const copy = { ...(event as unknown as Record<string, unknown>) };
  delete copy.type;
  delete copy.ts;
  return copy;
}

export function toWireHistoryEntry(
  event: SessionEvent,
  seq: number,
  ctx?: WireAdaptContext,
): WireHistoryEntry {
  const view = presentToolView(event);
  return {
    event: toDshWireSessionEvent(event, seq, ctx),
    ...(view ? { view } : {}),
  };
}

export function toMuxSessionEvent(
  sessionId: string,
  event: SessionEvent,
  seq: number,
  ids?: FaceWireIdMaps,
  inbox?: FaceInboxWireProjector,
): {
  readonly type: "session/event";
  readonly sessionId: string;
  readonly event: DshWireSessionEvent;
  readonly seq: number;
  readonly view?: ToolEventView;
} {
  const view = presentToolView(event);
  const ctx: WireAdaptContext = {
    sessionId,
    ...(ids ? { ids } : {}),
    ...(inbox ? { inbox } : {}),
  };
  return {
    type: "session/event",
    sessionId,
    event: toDshWireSessionEvent(event, seq, ctx),
    seq,
    ...(view ? { view } : {}),
  };
}
