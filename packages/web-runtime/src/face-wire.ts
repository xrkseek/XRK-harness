/**
 * Face mux/history wire → XRK SessionEvent (display path).
 * Host publishes DSH `{ type, seq, time, data }`; ChunkFold needs flat events.
 */

import type {
  ContentBlock,
  MessageContent,
  SessionEvent,
} from "@xrkseek/protocol";
import { isImageMediaType, isValidSessionEvent } from "@xrkseek/protocol";

export interface FaceWireEnvelope {
  readonly type: string;
  readonly seq: number;
  readonly time: number;
  readonly data: unknown;
  readonly ignorable?: true;
}

export function isFaceWireEnvelope(value: unknown): value is FaceWireEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.type === "string" &&
    typeof v.seq === "number" &&
    typeof v.time === "number" &&
    "data" in v
  );
}

/** Prefer XRK SessionEvent; else decode Face/DSH envelope. */
export function coerceSessionEvent(raw: unknown): SessionEvent | null {
  if (isValidSessionEvent(raw)) return raw;
  if (!isFaceWireEnvelope(raw)) return null;
  if (raw.ignorable) return null;
  return fromFaceWireEnvelope(raw);
}

export function wireSeq(raw: unknown, fallback = -1): number {
  if (isFaceWireEnvelope(raw)) return raw.seq;
  if (raw && typeof raw === "object" && typeof (raw as { seq?: unknown }).seq === "number") {
    return (raw as { seq: number }).seq;
  }
  return fallback;
}

function fromFaceWireEnvelope(wire: FaceWireEnvelope): SessionEvent | null {
  const ts = wire.time;
  const data =
    wire.data && typeof wire.data === "object"
      ? (wire.data as Record<string, unknown>)
      : {};

  switch (wire.type) {
    case "user/message": {
      const turnId =
        typeof data.id === "string"
          ? data.id
          : typeof data.turnId === "string"
            ? data.turnId
            : `wire:${wire.seq}`;
      const content = decodeContent(data.content);
      if (content === null) return null;
      return {
        type: "user/message",
        ts,
        turnId,
        content,
        ...(typeof data.rpcId === "string" ? { rpcId: data.rpcId } : {}),
      };
    }
    case "assistant/chunk":
    case "assistant.delta": {
      const text = decodeChunkText(data);
      if (text === null) return null;
      return {
        type: "assistant/chunk",
        ts,
        turnId: idStr(data.turn, wire.seq, "t"),
        stepId: idStr(data.step, wire.seq, "s"),
        text,
      };
    }
    case "assistant/message": {
      const message =
        data.message && typeof data.message === "object"
          ? (data.message as Record<string, unknown>)
          : data;
      const content = flattenMessageContent(message.content);
      return {
        type: "assistant/message",
        ts,
        turnId: idStr(data.turn, wire.seq, "t"),
        stepId: idStr(data.step, wire.seq, "s"),
        content,
      };
    }
    case "tool/call": {
      const callId =
        typeof data.callId === "string"
          ? data.callId
          : `call:${wire.seq}`;
      const name = typeof data.name === "string" ? data.name : "tool";
      return {
        type: "tool/call",
        ts,
        turnId: idStr(data.turn, wire.seq, "t"),
        stepId: idStr(data.step, wire.seq, "s"),
        call: {
          id: callId,
          name,
          arguments: data.arguments ?? {},
        },
      };
    }
    case "tool/result": {
      const message =
        data.message && typeof data.message === "object"
          ? (data.message as Record<string, unknown>)
          : {};
      const source =
        message.source && typeof message.source === "object"
          ? (message.source as Record<string, unknown>)
          : {};
      const toolCallId =
        typeof source.callId === "string"
          ? source.callId
          : `call:${wire.seq}`;
      const content = flattenToolResultContent(message.content);
      const isError = Boolean(
        data.error ||
          (Array.isArray(message.content) &&
            message.content.some(
              (row) =>
                row &&
                typeof row === "object" &&
                (row as { isError?: unknown }).isError === true,
            )),
      );
      return {
        type: "tool/result",
        ts,
        turnId: idStr(data.turn, wire.seq, "t"),
        stepId: idStr(data.step, wire.seq, "s"),
        result: {
          toolCallId,
          name: typeof data.name === "string" ? data.name : "tool",
          content,
          ...(isError ? { isError: true } : {}),
        },
      };
    }
    case "turn/start":
      return {
        type: "turn/start",
        ts,
        turnId: idStr(data.turn ?? data.turnId, wire.seq, "t"),
      };
    case "turn/end": {
      const reasonRaw = data.reason;
      if (
        !reasonRaw ||
        typeof reasonRaw !== "object" ||
        typeof (reasonRaw as { kind?: unknown }).kind !== "string"
      ) {
        return null;
      }
      return {
        type: "turn/end",
        ts,
        turnId: idStr(data.turn ?? data.turnId, wire.seq, "t"),
        reason: reasonRaw as Extract<SessionEvent, { type: "turn/end" }>["reason"],
      };
    }
    case "step/start":
    case "step/end":
      return {
        type: wire.type,
        ts,
        turnId: idStr(data.turn ?? data.turnId, wire.seq, "t"),
        stepId: idStr(data.step ?? data.stepId, wire.seq, "s"),
      };
    case "safety/notice": {
      const content =
        typeof data.content === "string"
          ? data.content
          : typeof data.message === "string"
            ? data.message
            : null;
      const kind = data.kind;
      if (
        content === null ||
        (kind !== "loop_soft" &&
          kind !== "loop_hard" &&
          kind !== "mistake_limit" &&
          kind !== "api_error")
      ) {
        return null;
      }
      return {
        type: "safety/notice",
        ts,
        turnId: idStr(data.turnId ?? data.turn, wire.seq, "t"),
        kind,
        content,
      };
    }
    default:
      return null;
  }
}

function idStr(value: unknown, seq: number, prefix: string): string {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return `${prefix}:${seq}`;
}

function decodeContent(raw: unknown): MessageContent | null {
  if (typeof raw === "string") return raw;
  if (!Array.isArray(raw)) return null;
  const blocks: ContentBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      blocks.push({ type: "text", text: b.text });
    } else if (
      b.type === "image" &&
      b.attachment &&
      typeof b.attachment === "object"
    ) {
      const a = b.attachment as Record<string, unknown>;
      if (
        typeof a.attachmentId === "string" &&
        isImageMediaType(a.mediaType) &&
        typeof a.bytes === "number" &&
        typeof a.width === "number" &&
        typeof a.height === "number"
      ) {
        blocks.push({
          type: "image",
          attachment: {
            attachmentId: a.attachmentId,
            mediaType: a.mediaType,
            bytes: a.bytes,
            width: a.width,
            height: a.height,
            ...(typeof a.name === "string" ? { name: a.name } : {}),
          },
        });
      }
    }
  }
  return blocks.length > 0 ? blocks : null;
}

function decodeChunkText(data: Record<string, unknown>): string | null {
  if (typeof data.text === "string") return data.text;
  const chunk = data.chunk;
  if (chunk && typeof chunk === "object") {
    const c = chunk as Record<string, unknown>;
    if (typeof c.text === "string") return c.text;
  }
  return null;
}

function flattenMessageContent(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (!Array.isArray(raw)) return "";
  const parts: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.join("");
}

function flattenToolResultContent(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (!Array.isArray(raw)) return "";
  const parts: string[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.content === "string") {
      parts.push(r.content);
      continue;
    }
    const text = flattenMessageContent(r.content);
    if (text) parts.push(text);
  }
  return parts.join("\n");
}
