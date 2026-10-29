import { asRecord, type FaceHandler } from "./types.js";

/**
 * Press a button on the Claude Code mods AbovePrompt band.
 * Payload: `{ sessionId, generation, actionId }`.
 */
export const sessionPressBand: FaceHandler = async (
  runtime,
  _rpcId,
  payload,
) => {
  const p = asRecord(payload);
  const sessionId = String(p.sessionId ?? "").trim();
  const actionId = String(p.actionId ?? "").trim();
  const generation =
    typeof p.generation === "number" && Number.isFinite(p.generation)
      ? Math.trunc(p.generation)
      : NaN;
  if (!sessionId || !actionId || !Number.isFinite(generation) || generation < 0) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "sessionId, generation (≥0), and actionId required",
      },
    };
  }
  const snap = await runtime.pressBand(sessionId, generation, actionId);
  if (snap === undefined) {
    return {
      ok: false,
      error: {
        code: "band-unavailable",
        message: "no plugin band for this session",
      },
    };
  }
  return {
    ok: true,
    value: {
      generation: snap.generation,
      tree: snap.tree,
    },
  };
};
