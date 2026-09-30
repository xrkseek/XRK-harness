/**
 * Face `canvas.list` / `canvas.get` — shell Overview player.
 */
import { canvasWorkspaceIdForSession } from "../canvas-tools.js";
import { isValidCanvasId } from "../canvas-store.js";
import { asRecord, remoteArgs, type FaceHandler } from "./types.js";

function sessionIdOf(payload: unknown): string {
  const args = remoteArgs(payload);
  const flat = asRecord(payload);
  return String(
    args.sessionId ?? flat.sessionId ?? args.agentId ?? flat.agentId ?? "",
  ).trim();
}

export const canvasList: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  if (!runtime.store.has(sessionId)) {
    return {
      ok: false,
      error: { code: "session-not-found", message: sessionId },
    };
  }
  const workspaceId = canvasWorkspaceIdForSession(runtime, sessionId);
  const items = runtime.canvases.list(workspaceId);
  return {
    ok: true,
    value: {
      workspaceId,
      generation: runtime.canvases.getGeneration(),
      items,
    },
  };
};

export const canvasGet: FaceHandler = async (runtime, _rpcId, payload) => {
  const sessionId = sessionIdOf(payload);
  const args = remoteArgs(payload);
  const flat = asRecord(payload);
  const id = String(args.id ?? flat.id ?? "").trim();
  if (!sessionId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "sessionId required" },
    };
  }
  if (!runtime.store.has(sessionId)) {
    return {
      ok: false,
      error: { code: "session-not-found", message: sessionId },
    };
  }
  if (!isValidCanvasId(id)) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "id required" },
    };
  }
  const workspaceId = canvasWorkspaceIdForSession(runtime, sessionId);
  const canvas = runtime.canvases.get(workspaceId, id);
  return {
    ok: true,
    value: {
      workspaceId,
      canvas: canvas ?? null,
    },
  };
};
