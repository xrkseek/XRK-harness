import { remoteArgs, type FaceHandler } from "./types.js";
import type { GoalRef } from "../goal-store.js";

function readRef(raw: unknown): GoalRef | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.revision !== "number") return undefined;
  return { id: o.id, revision: o.revision };
}

function agentId(args: Record<string, unknown>): string {
  return String(args.agentId ?? args.sessionId ?? "").trim();
}

export const goalsCreate: FaceHandler = async (runtime, _rpcId, payload) => {
  const args = remoteArgs(payload);
  const request =
    args.request && typeof args.request === "object" && !Array.isArray(args.request)
      ? (args.request as Record<string, unknown>)
      : args;
  const objective = String(request.objective ?? "").trim();
  const maxRaw = request.maxGoalRounds;
  const maxGoalRounds = typeof maxRaw === "number" ? maxRaw : undefined;
  return runtime.goals.create(agentId(args), objective, maxGoalRounds);
};

export const goalsEdit: FaceHandler = async (runtime, _rpcId, payload) => {
  const args = remoteArgs(payload);
  const ref = readRef(args.ref);
  if (!ref) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "ref required" },
    };
  }
  const request =
    args.request && typeof args.request === "object" && !Array.isArray(args.request)
      ? (args.request as Record<string, unknown>)
      : {};
  return runtime.goals.edit(agentId(args), ref, {
    ...(typeof request.objective === "string"
      ? { objective: request.objective }
      : {}),
    ...(typeof request.maxGoalRounds === "number"
      ? { maxGoalRounds: request.maxGoalRounds }
      : {}),
  });
};

function mutateRef(
  runtime: Parameters<FaceHandler>[0],
  payload: unknown,
  verb: "pause" | "resume" | "complete" | "clear",
) {
  const args = remoteArgs(payload);
  const ref = readRef(args.ref);
  if (!ref) {
    return {
      ok: false as const,
      error: { code: "invalid-payload", message: "ref required" },
    };
  }
  const id = agentId(args);
  if (verb === "pause") return runtime.goals.pause(id, ref);
  if (verb === "resume") return runtime.goals.resume(id, ref);
  if (verb === "complete") return runtime.goals.complete(id, ref);
  return runtime.goals.clear(id, ref);
}

export const goalsPause: FaceHandler = async (runtime, _rpcId, payload) =>
  mutateRef(runtime, payload, "pause");
export const goalsResume: FaceHandler = async (runtime, _rpcId, payload) =>
  mutateRef(runtime, payload, "resume");
export const goalsComplete: FaceHandler = async (runtime, _rpcId, payload) =>
  mutateRef(runtime, payload, "complete");
export const goalsClear: FaceHandler = async (runtime, _rpcId, payload) =>
  mutateRef(runtime, payload, "clear");
