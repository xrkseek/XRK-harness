/**
 * Face `messageFeedback/*` — process-local compare-and-set sidecar.
 * Typert result is nested inside Face `ok: true` so the shell can distinguish
 * carrier failure from business codes (session-not-found, version-conflict, …).
 */

import { readSessionEvents, type SessionStore } from "@xrkseek/core-session";
import type { FaceRpcResult } from "./types.js";

export const MESSAGE_FEEDBACK_NOTE_MAX_BYTES = 4096;

export type MessageFeedbackRating = "positive" | "negative";

export interface MessageFeedbackItem {
  readonly messageId: string;
  readonly rating: MessageFeedbackRating;
  readonly note?: string;
  readonly version: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

type TypertOk<T> = { readonly ok: true; readonly value: T };
type TypertFail = {
  readonly ok: false;
  readonly error: Record<string, unknown> & { readonly code: string };
};

function carrierOk<T>(value: T): FaceRpcResult<TypertOk<T>> {
  return { ok: true, value: { ok: true, value } };
}

function carrierBiz(error: TypertFail["error"]): FaceRpcResult<TypertFail> {
  return { ok: true, value: { ok: false, error } };
}

function assistantMessageExists(
  store: SessionStore,
  sessionId: string,
  messageId: string,
): boolean {
  const events = readSessionEvents(store, sessionId);
  for (const e of events) {
    if (e.type !== "assistant/message") continue;
    if (`${e.turnId}:${e.stepId}` === messageId) return true;
  }
  return false;
}

function sessionExists(store: SessionStore, sessionId: string): boolean {
  return store.has(sessionId);
}

export class FaceMessageFeedbackStore {
  private readonly bySession = new Map<
    string,
    Map<string, MessageFeedbackItem>
  >();

  list(
    store: SessionStore,
    sessionId: string,
  ): FaceRpcResult<TypertOk<{ items: MessageFeedbackItem[] }> | TypertFail> {
    if (!sessionId) {
      return {
        ok: false,
        error: { code: "invalid-payload", message: "sessionId required" },
      };
    }
    if (!sessionExists(store, sessionId)) {
      return carrierBiz({ code: "session-not-found", sessionId });
    }
    const items = [...(this.bySession.get(sessionId)?.values() ?? [])];
    return carrierOk({ items });
  }

  put(
    store: SessionStore,
    input: {
      readonly sessionId: string;
      readonly messageId: string;
      readonly rating: unknown;
      readonly note?: unknown;
      readonly notePresent: boolean;
      readonly ifVersion: unknown;
    },
  ): FaceRpcResult<TypertOk<MessageFeedbackItem> | TypertFail> {
    const { sessionId, messageId } = input;
    if (!sessionId || !messageId) {
      return {
        ok: false,
        error: {
          code: "invalid-payload",
          message: "sessionId and messageId required",
        },
      };
    }
    if (input.rating !== "positive" && input.rating !== "negative") {
      return {
        ok: false,
        error: { code: "invalid-payload", message: "rating required" },
      };
    }
    if (input.ifVersion !== null && typeof input.ifVersion !== "string") {
      return {
        ok: false,
        error: { code: "invalid-payload", message: "ifVersion required" },
      };
    }
    if (!sessionExists(store, sessionId)) {
      return carrierBiz({ code: "session-not-found", sessionId });
    }
    if (!assistantMessageExists(store, sessionId, messageId)) {
      return carrierBiz({
        code: "target-not-found",
        sessionId,
        messageId,
      });
    }

    let note: string | undefined;
    if (input.notePresent) {
      if (typeof input.note !== "string") {
        return {
          ok: false,
          error: { code: "invalid-payload", message: "note must be a string" },
        };
      }
      if (!input.note.trim()) {
        return carrierBiz({ code: "note-blank" });
      }
      const actualBytes = Buffer.byteLength(input.note, "utf8");
      if (actualBytes > MESSAGE_FEEDBACK_NOTE_MAX_BYTES) {
        return carrierBiz({
          code: "note-too-large",
          maxBytes: MESSAGE_FEEDBACK_NOTE_MAX_BYTES,
          actualBytes,
        });
      }
      note = input.note;
    }

    const bucket = this.bucket(sessionId);
    const current = bucket.get(messageId);
    if (input.ifVersion === null) {
      if (current) {
        return carrierBiz({ code: "version-conflict", current });
      }
    } else if (!current || current.version !== input.ifVersion) {
      return carrierBiz({
        code: "version-conflict",
        current: current ?? null,
      });
    }

    const now = Date.now();
    const next: MessageFeedbackItem = {
      messageId,
      rating: input.rating,
      ...(note !== undefined ? { note } : {}),
      version: crypto.randomUUID(),
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    bucket.set(messageId, next);
    return carrierOk(next);
  }

  delete(
    store: SessionStore,
    input: {
      readonly sessionId: string;
      readonly messageId: string;
      readonly ifVersion: unknown;
    },
  ): FaceRpcResult<TypertOk<{ absent: true }> | TypertFail> {
    const { sessionId, messageId } = input;
    if (!sessionId || !messageId) {
      return {
        ok: false,
        error: {
          code: "invalid-payload",
          message: "sessionId and messageId required",
        },
      };
    }
    if (typeof input.ifVersion !== "string" || !input.ifVersion) {
      return {
        ok: false,
        error: { code: "invalid-payload", message: "ifVersion required" },
      };
    }
    if (!sessionExists(store, sessionId)) {
      return carrierBiz({ code: "session-not-found", sessionId });
    }
    const bucket = this.bySession.get(sessionId);
    const current = bucket?.get(messageId);
    if (!current) {
      return carrierOk({ absent: true as const });
    }
    if (current.version !== input.ifVersion) {
      return carrierBiz({ code: "version-conflict", current });
    }
    bucket?.delete(messageId);
    return carrierOk({ absent: true as const });
  }

  private bucket(sessionId: string): Map<string, MessageFeedbackItem> {
    let map = this.bySession.get(sessionId);
    if (!map) {
      map = new Map();
      this.bySession.set(sessionId, map);
    }
    return map;
  }
}
