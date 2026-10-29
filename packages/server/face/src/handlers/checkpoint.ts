/**
 * Face RPC: session.checkpoint.list | planRestore | restore | snapshot
 * Worktree file restore (shadow git). Distinct from session.fork / fork-cut.
 */

import { sessionNotFoundMessage } from "../face-error-text.js";
import type { FaceHandler } from "./types.js";
import { asRecord } from "./types.js";
import {
  readSessionEvents,
  sessionEventCount,
  truncateSession,
} from "@xrkseek/core-session";
import type { WorkspaceCheckpointRecord } from "@xrkseek/checkpoint";
import {
  checkpointFail,
  findCheckpointAtOrBefore,
  workspaceCheckpointStoreForSession,
} from "../workspace-checkpoint.js";
import { resetFaceStateAfterLogCut } from "../log-cut-reset.js";

function requireSession(
  runtime: Parameters<FaceHandler>[0],
  sessionId: string,
): { ok: true } | { ok: false; result: Awaited<ReturnType<FaceHandler>> } {
  if (!sessionId) {
    return {
      ok: false,
      result: {
        ok: false,
        error: { code: "invalid-payload", message: "sessionId required" },
      },
    };
  }
  if (!runtime.store.has(sessionId)) {
    return {
      ok: false,
      result: {
        ok: false,
        error: { code: "session-not-found", message: sessionNotFoundMessage(sessionId) },
      },
    };
  }
  return { ok: true };
}

/** Chat vs file-restore alignment (checkpoint.seq = event count at snapshot). */
function chatAlignFields(
  runtime: Parameters<FaceHandler>[0],
  sessionId: string,
  record: WorkspaceCheckpointRecord,
): {
  readonly chatSeq: number;
  readonly eventCount: number;
  readonly chatAhead: boolean;
} {
  const eventCount = sessionEventCount(runtime.store, sessionId);
  const chatSeq = record.seq;
  return {
    chatSeq,
    eventCount,
    chatAhead: eventCount > chatSeq,
  };
}

export const sessionCheckpointList: FaceHandler = async (runtime, _rpcId, payload) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "").trim();
  const gate = requireSession(runtime, sessionId);
  if (!gate.ok) return gate.result;

  try {
    const store = workspaceCheckpointStoreForSession(runtime, sessionId);
    const all = typeof p.allSessions === "boolean" && p.allSessions
      ? store.list()
      : store.list().filter((r) => r.sessionId === sessionId);
    return { ok: true, value: { items: all } };
  } catch (err) {
    return checkpointFail(err);
  }
};

export const sessionCheckpointPlanRestore: FaceHandler = async (
  runtime,
  _rpcId,
  payload,
) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "").trim();
  const gate = requireSession(runtime, sessionId);
  if (!gate.ok) return gate.result;

  const id = String(p.id ?? p.checkpointId ?? "").trim();
  const atSeq =
    typeof p.atSeq === "number" && Number.isFinite(p.atSeq)
      ? Math.floor(p.atSeq)
      : undefined;

  try {
    const store = workspaceCheckpointStoreForSession(runtime, sessionId);
    let targetId = id;
    let record: WorkspaceCheckpointRecord | undefined;
    if (!targetId && atSeq !== undefined) {
      const hit = findCheckpointAtOrBefore(store, sessionId, atSeq);
      if (!hit) {
        return {
          ok: false,
          error: {
            code: "invalid-payload",
            message: `no checkpoint at or before seq ${atSeq}`,
            details: { checkpointCode: "unknown-checkpoint" },
          },
        };
      }
      targetId = hit.id;
      record = hit;
    }
    if (!targetId) {
      return {
        ok: false,
        error: {
          code: "invalid-payload",
          message: "id or atSeq required",
        },
      };
    }
    record ??= store.list().find((r) => r.id === targetId);
    const plan = await store.planRestore(targetId);
    const align = record
      ? chatAlignFields(runtime, sessionId, record)
      : undefined;
    return {
      ok: true,
      value: {
        ...plan,
        ...(align ?? {}),
      },
    };
  } catch (err) {
    return checkpointFail(err);
  }
};

export const sessionCheckpointRestore: FaceHandler = async (
  runtime,
  _rpcId,
  payload,
) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "").trim();
  const gate = requireSession(runtime, sessionId);
  if (!gate.ok) return gate.result;

  const id = String(p.id ?? p.checkpointId ?? "").trim();
  const atSeq =
    typeof p.atSeq === "number" && Number.isFinite(p.atSeq)
      ? Math.floor(p.atSeq)
      : undefined;
  const prune = p.prune === true;
  const truncateChat = p.truncateChat === true;

  try {
    const store = workspaceCheckpointStoreForSession(runtime, sessionId);
    let targetId = id;
    let record: WorkspaceCheckpointRecord | undefined;
    if (!targetId && atSeq !== undefined) {
      const hit = findCheckpointAtOrBefore(store, sessionId, atSeq);
      if (!hit) {
        return {
          ok: false,
          error: {
            code: "invalid-payload",
            message: `no checkpoint at or before seq ${atSeq}`,
            details: { checkpointCode: "unknown-checkpoint" },
          },
        };
      }
      targetId = hit.id;
      record = hit;
    }
    if (!targetId) {
      return {
        ok: false,
        error: {
          code: "invalid-payload",
          message: "id or atSeq required",
        },
      };
    }
    record ??= store.list().find((r) => r.id === targetId);
    if (!record) {
      return {
        ok: false,
        error: {
          code: "invalid-payload",
          message: `unknown checkpoint ${targetId}`,
          details: { checkpointCode: "unknown-checkpoint" },
        },
      };
    }

    const result = await store.restore(targetId, { prune });
    const align = chatAlignFields(runtime, sessionId, record);

    let chatTruncated = false;
    let eventCount = align.eventCount;
    if (truncateChat && align.chatAhead) {
      if (typeof runtime.store.replacePrefix !== "function") {
        return {
          ok: false,
          error: {
            code: "truncate-unsupported",
            message:
              "workspace restored but session store cannot truncateChat (no replacePrefix)",
          },
        };
      }
      if (runtime.drain.isActive(sessionId)) {
        await runtime.drain.cancel(sessionId);
      }
      try {
        // checkpoint.seq is the event count at snapshot → keep [0, seq).
        truncateSession(runtime.store, sessionId, record.seq);
      } catch (err) {
        return {
          ok: false,
          error: {
            code: "truncate-failed",
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
      eventCount = resetFaceStateAfterLogCut(runtime, sessionId);
      chatTruncated = true;
    }

    return {
      ok: true,
      value: {
        ...result,
        chatSeq: align.chatSeq,
        eventCount,
        chatAhead: eventCount > align.chatSeq,
        chatTruncated,
      },
    };
  } catch (err) {
    return checkpointFail(err);
  }
};

export const sessionCheckpointSnapshot: FaceHandler = async (
  runtime,
  _rpcId,
  payload,
) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "").trim();
  const gate = requireSession(runtime, sessionId);
  if (!gate.ok) return gate.result;

  const seq =
    typeof p.seq === "number" && Number.isFinite(p.seq)
      ? p.seq
      : undefined;
  const label =
    typeof p.label === "string" && p.label.trim() ? p.label.trim() : undefined;

  try {
    const store = workspaceCheckpointStoreForSession(runtime, sessionId);
    const record = await store.snapshot({
      sessionId,
      seq: seq ?? readSessionEvents(runtime.store, sessionId).length,
      ...(label ? { label } : {}),
    });
    return { ok: true, value: record };
  } catch (err) {
    return checkpointFail(err);
  }
};
