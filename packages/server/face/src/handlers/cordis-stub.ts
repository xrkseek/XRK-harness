/**
 * Product-shell Cordis panel calls `dynamicCordisRunner/*`.
 * Host does not embed Cordis `apply(ctx)` — return schema-valid empty / no-op
 * so the shell stays up (inventory empty, stop = not-running).
 */
import { asRecord, remoteArgs, type FaceHandler } from "./types.js";

const ABSENT = "cordis host runner is not embedded";

function arg(payload: unknown, key: string, index: number): string {
  const p = asRecord(payload);
  if (Array.isArray(p.args)) {
    const v = p.args[index];
    return v == null ? "" : String(v);
  }
  const args = remoteArgs(payload);
  return String(args[key] ?? "").trim();
}

const ok = (value: unknown): Awaited<ReturnType<FaceHandler>> => ({
  ok: true,
  value,
});

const STUBS: Record<string, FaceHandler> = {
  "dynamicCordisRunner/inventory": async () => ok([]),
  "dynamicCordisRunner/syncInspectManifest": async () => ok(null),
  "dynamicCordisRunner/reportRenderFailure": async () => ok(null),
  "dynamicCordisRunner/reportClientGuardFailure": async () => ok(null),
  "dynamicCordisRunner/resolveInspectQuery": async () => ok({ accepted: false }),
  "dynamicCordisRunner/resolveRequestRun": async () => ok({ accepted: false }),
  "dynamicCordisRunner/stopFromPanel": async () =>
    ok({ ok: false, reason: "not-running", message: ABSENT }),
  "dynamicCordisRunner/undefineFromPanel": async () =>
    ok({ ok: false, reason: "plugin-missing", message: ABSENT }),
  "dynamicCordisRunner/invoke": async () =>
    ok({
      ok: false,
      code: "plugin-not-running",
      message: ABSENT,
    }),
  "dynamicCordisRunner/getClientCode": async (_runtime, _rpcId, payload) => {
    const pluginId = arg(payload, "pluginId", 1) || "unknown";
    const pluginRunId = arg(payload, "pluginRunId", 2) || "unknown";
    return ok({
      code: "",
      name: "",
      pluginId,
      packageId: arg(payload, "packageId", 3) || pluginId,
      pluginRunId,
    });
  },
  "dynamicCordisRunner/runHostHalf": async () =>
    ok({ ok: false, message: ABSENT }),
  "dynamicCordisRunner/settleUserRun": async () =>
    ok({
      ok: false,
      reason: "rejected",
      message: ABSENT,
    }),
};

export function cordisRunnerHandler(method: string): FaceHandler | undefined {
  return STUBS[method];
}
