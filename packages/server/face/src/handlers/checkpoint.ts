/**
 * Face RPC: session.checkpoint.list | planRestore | restore | snapshot
 * Worktree file restore (shadow git). Distinct from session.fork / fork-cut.
 */

import type { FaceHandler } from "./types.js";
import { asRecord } from "./types.js";
import { readSessionEvents } from "@xrkseek/core-session";
import {
  checkpointFail,
  findCheckpointAtOrBefore,
  workspaceCheckpointStoreForSession,
} from "../workspace-checkpoint.js";

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
        error: { code: "session-not-found", message: sessionId },
      },
    };
  }
  return { ok: true };
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
    const plan = await store.planRestore(targetId);
    return { ok: true, value: plan };
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

  try {
    const store = workspaceCheckpointStoreForSession(runtime, sessionId);
    let targetId = id;
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
    const result = await store.restore(targetId, { prune });
    return { ok: true, value: result };
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
