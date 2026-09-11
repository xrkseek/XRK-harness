/**
 * Session-level feedback (`feedback/record`) — command-independent producer
 * and Face `sessionFeedback/record`. Optional local conversation-slice sidecar
 * under the Host sessions directory (not OTel upload).
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readSessionEvents, type SessionStore } from "@xrkseek/core-session";
import type { FeedbackCategory, SessionEvent } from "@xrkseek/protocol";
import type { FaceRpcResult } from "./types.js";

/** Product taxonomy in presentation order (durable log vocabulary). */
export const FEEDBACK_CATEGORIES = [
  "task-result",
  "instruction-following",
  "product-interaction",
  "service-stability",
  "resource-cost",
  "security-privacy-permission",
  "other",
] as const satisfies readonly FeedbackCategory[];

export const FEEDBACK_TEXT_MAX_CHARS = 8192;

/** Soft cap for one slice JSON on disk (bytes). */
const SLICE_JSON_MAX_BYTES = 2 * 1024 * 1024;

export type SessionFeedbackEntry = {
  readonly text?: string;
  readonly category?: FeedbackCategory;
};

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

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return (
    typeof value === "string" &&
    (FEEDBACK_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * Normalize human input: trim text (blank → absent); keep category when valid.
 */
export function normalizeFeedbackEntry(
  entry: SessionFeedbackEntry,
): SessionFeedbackEntry {
  const text = entry.text?.trim() ?? "";
  return {
    ...(text.length > 0 ? { text } : {}),
    ...(entry.category !== undefined ? { category: entry.category } : {}),
  };
}

function mintSliceId(): string {
  return `slice-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

/**
 * Persist a conversation-prefix sidecar next to sessions; returns sliceId or
 * undefined when the directory is unset or write fails (record still succeeds).
 */
export function writeFeedbackConversationSlice(
  slicesDir: string | undefined,
  sessionId: string,
  events: readonly SessionEvent[],
): string | undefined {
  if (!slicesDir) return undefined;
  try {
    const sliceId = mintSliceId();
    const dir = path.join(slicesDir, sessionId);
    mkdirSync(dir, { recursive: true });
    let eventsOut: readonly SessionEvent[] = events;
    let payload = {
      sessionId,
      sliceId,
      recordedAt: Date.now(),
      eventCount: eventsOut.length,
      events: eventsOut,
    };
    let json = JSON.stringify(payload);
    if (Buffer.byteLength(json, "utf8") > SLICE_JSON_MAX_BYTES) {
      // Keep the most recent events that fit (related prefix near the remark).
      let lo = 0;
      let hi = events.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        eventsOut = events.slice(events.length - mid);
        payload = {
          sessionId,
          sliceId,
          recordedAt: Date.now(),
          eventCount: eventsOut.length,
          events: eventsOut,
        };
        json = JSON.stringify(payload);
        if (Buffer.byteLength(json, "utf8") <= SLICE_JSON_MAX_BYTES) lo = mid;
        else hi = mid - 1;
      }
      eventsOut = events.slice(events.length - lo);
      payload = {
        sessionId,
        sliceId,
        recordedAt: Date.now(),
        eventCount: eventsOut.length,
        events: eventsOut,
      };
      json = JSON.stringify(payload);
    }
    writeFileSync(path.join(dir, `${sliceId}.json`), json, "utf8");
    return sliceId;
  } catch {
    return undefined;
  }
}

/**
 * Append one `feedback/record` (log-only). Blank text is omitted; category-only
 * and empty drafts are valid. Optionally attaches a conversation-slice id.
 */
export function recordSessionFeedback(
  store: SessionStore,
  sessionId: string,
  entry: SessionFeedbackEntry,
  options?: { readonly slicesDir?: string; readonly ts?: number },
): { readonly recorded: true; readonly sliceId?: string } {
  const normalized = normalizeFeedbackEntry(entry);
  const events = readSessionEvents(store, sessionId);
  const sliceId = writeFeedbackConversationSlice(
    options?.slicesDir,
    sessionId,
    events,
  );
  const ts = options?.ts ?? Date.now();
  store.append(sessionId, {
    type: "feedback/record",
    ts,
    ...(normalized.text !== undefined ? { text: normalized.text } : {}),
    ...(normalized.category !== undefined
      ? { category: normalized.category }
      : {}),
    ...(sliceId !== undefined ? { sliceId } : {}),
  });
  return {
    recorded: true,
    ...(sliceId !== undefined ? { sliceId } : {}),
  };
}

/**
 * Face Typert `sessionFeedback/record` — nested `{ ok, value|error }` like
 * messageFeedback (carrier ok wraps business result).
 */
export function sessionFeedbackRecord(
  store: SessionStore,
  input: {
    readonly sessionId: string;
    readonly text?: unknown;
    readonly category?: unknown;
  },
  options?: { readonly slicesDir?: string },
): FaceRpcResult<
  | TypertOk<{ recorded: true; sliceId?: string }>
  | TypertFail
> {
  const sessionId = String(input.sessionId ?? "").trim();
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  if (!store.has(sessionId)) {
    return carrierBiz({ code: "session-not-found", sessionId });
  }
  if (input.category !== undefined && !isFeedbackCategory(input.category)) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "invalid feedback category" },
    };
  }
  const text =
    typeof input.text === "string" ? input.text : undefined;
  if (text !== undefined && text.trim().length > FEEDBACK_TEXT_MAX_CHARS) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: `Feedback text must be at most ${FEEDBACK_TEXT_MAX_CHARS} characters.`,
      },
    };
  }
  const result = recordSessionFeedback(
    store,
    sessionId,
    {
      ...(text !== undefined ? { text } : {}),
      ...(isFeedbackCategory(input.category)
        ? { category: input.category }
        : {}),
    },
    {
      ...(options?.slicesDir !== undefined
        ? { slicesDir: options.slicesDir }
        : {}),
    },
  );
  return carrierOk({
    recorded: true as const,
    ...(result.sliceId !== undefined ? { sliceId: result.sliceId } : {}),
  });
}
