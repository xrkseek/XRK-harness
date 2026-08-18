/**
 * XRK SessionEvent → Face mux/history wire row.
 *
 * DeepSeek Web expects `{ type, seq, time, data }` with seq inside the event.
 * turn/step use session-scoped monotonic maps when provided (preferred);
 * otherwise fall back to wireNumericId hash for isolated unit tests.
 */

import type { MessageContent, SessionEvent } from "@xrkseek/protocol";
import { asContentBlocks } from "@xrkseek/protocol";
import {
  type FaceInboxWireProjector,
  type DshInboxSplice,
} from "./inbox-wire.js";
import { presentToolView, type PresentToolLookup, type ToolEventView } from "./tool-view.js";
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
  "command/run": "command/run",
  "command/done": "command/done",
  "todo/write": "todo/write",
  "permission/preset": "permission/preset",
  "sandbox/mode": "sandbox/mode",
  "approval/policy": "approval/policy",
  "plan/mode": "plan/mode",
  "feedback/record": "feedback/record",
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
  /**
   * Call-id → { name, args } pairing for result-time presenters (DSH `argsFor`).
   * History precomputes from the log; mux uses FaceToolArgMaps.
   */
  readonly toolArgs?: ReadonlyMap<
    string,
    { readonly name: string; readonly args: unknown }
  >;
  /** Tool presenter lookup (DSH `ctx.tools.get`). Omit → no view. */
  readonly getTool?: PresentToolLookup["getTool"];
}

function wireContentBlocks(content: MessageContent): readonly (
  | { type: "text"; text: string }
  | {
      type: "image";
      attachment: {
        attachmentId: string;
        mediaType: string;
        bytes: number;
        width: number;
        height: number;
        name?: string;
      };
    }
)[] {
  return asContentBlocks(content).map((block) =>
    block.type === "text"
      ? { type: "text" as const, text: block.text }
      : { type: "image" as const, attachment: { ...block.attachment } },
  );
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
  const blocks: unknown[] = [];
  if (event.reasoning?.trim()) {
    blocks.push({ type: "reasoning", text: event.reasoning });
  }
  blocks.push(...wireContentBlocks(event.content));
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
          content: wireContentBlocks(event.content),
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
          chunk: {
            type:
              event.kind === "reasoning" ? "reasoning-delta" : "text-delta",
            index: event.index ?? 0,
            text: event.text,
          },
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
                content: wireContentBlocks(event.result.content),
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
    case "command/run":
      return {
        type: "command/run",
        seq,
        time,
        data: {
          commandId: event.commandId,
          name: event.name,
          source: event.source,
          ...(event.args !== undefined ? { args: event.args } : {}),
        },
      };
    case "command/done":
      return {
        type: "command/done",
        seq,
        time,
        data: {
          commandId: event.commandId,
          kind: event.kind,
          ...(event.text !== undefined ? { text: event.text } : {}),
          ...(event.sourceEventSeq !== undefined
            ? { sourceEventSeq: event.sourceEventSeq }
            : {}),
        },
      };
    case "todo/write":
      return {
        type: "todo/write",
        seq,
        time,
        data: { todos: event.todos },
      };
    case "permission/preset":
    case "sandbox/mode":
    case "approval/policy":
    case "plan/mode":
    case "feedback/record":
      return {
        type: event.type,
        seq,
        time,
        data: stripBase(event),
        ignorable: true,
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

function toolLookup(ctx?: WireAdaptContext): PresentToolLookup | undefined {
  if (!ctx?.getTool) return undefined;
  return {
    getTool: ctx.getTool,
    argsFor: (callId) => ctx.toolArgs?.get(callId),
  };
}

export function toWireHistoryEntry(
  event: SessionEvent,
  seq: number,
  ctx?: WireAdaptContext,
): WireHistoryEntry {
  const view = presentToolView(event, toolLookup(ctx));
  return {
    event: toDshWireSessionEvent(event, seq, ctx),
    ...(view ? { view } : {}),
  };
}

export function toMuxSessionEvent(
  sessionId: string,
  event: SessionEvent,
  seq: number,
  ctx?: WireAdaptContext,
): {
  readonly type: "session/event";
  readonly sessionId: string;
  readonly event: DshWireSessionEvent;
  readonly seq: number;
  readonly view?: ToolEventView;
} {
  const view = presentToolView(event, toolLookup(ctx));
  const wireCtx: WireAdaptContext = {
    sessionId,
    ...(ctx?.ids ? { ids: ctx.ids } : {}),
    ...(ctx?.inbox ? { inbox: ctx.inbox } : {}),
    ...(ctx?.toolArgs ? { toolArgs: ctx.toolArgs } : {}),
    ...(ctx?.getTool ? { getTool: ctx.getTool } : {}),
  };
  return {
    type: "session/event",
    sessionId,
    event: toDshWireSessionEvent(event, seq, wireCtx),
    seq,
    ...(view ? { view } : {}),
  };
}
