/**
 * Product-shell Cordis panel calls `dynamicCordisRunner/*`.
 * Host half runs via dsh-compat `host.mjs` apply; client half via staged `client.js`.
 */
import { isCordisBridgedForInvoke } from "../cordis-bridge.js";
import { listFacePluginInventory } from "../plugin-inventory.js";
import { asRecord, remoteArgs, type FaceHandler } from "./types.js";
import { readStagedClientCode } from "./staged-client-code.js";

const BRIDGE_NOTE =
  "Cordis fiber runs in isolated Node subprocess when in-process host.mjs apply fails; otherwise XRK dsh-compat in-process.";

const BRIDGES = [
  "http-baseline",
  "host-apply-shim",
  "honest-http-catchall",
  "dsh-upgrade-registry",
] as const;

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

function hostPackageRecord(
  runtime: Parameters<FaceHandler>[0],
  packageId: string,
):
  | { readonly packageName: string; readonly rpcChannels: readonly string[] }
  | undefined {
  const id = packageId.trim();
  return runtime.hostPublic?.cordisHostPackages?.find(
    (row) => row.packageName === id,
  );
}

function parseInvokeRpc(
  payload: unknown,
): {
  readonly channel?: string;
  readonly endpoint: string;
  readonly rpcPayload: Record<string, unknown>;
} | null {
  const p = asRecord(payload);
  const bag =
    Array.isArray(p.args) && p.args[0] && typeof p.args[0] === "object"
      ? (p.args[0] as Record<string, unknown>)
      : remoteArgs(payload);
  const channel = String(
    bag.channel ?? bag.rpcChannel ?? bag.prefix ?? "",
  ).trim();
  const endpoint = String(
    bag.method ?? bag.endpoint ?? bag.action ?? "",
  ).trim();
  if (!channel && !endpoint) return null;
  const nested = bag.payload;
  const rpcPayload =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : Object.fromEntries(
          Object.entries(bag).filter(
            ([key]) =>
              ![
                "channel",
                "rpcChannel",
                "prefix",
                "method",
                "endpoint",
                "action",
                "payload",
                "pluginId",
                "packageId",
                "pluginRunId",
              ].includes(key),
          ),
        );
  return {
    ...(channel ? { channel } : {}),
    endpoint,
    rpcPayload,
  };
}

function inventoryFromRuntime(
  runtime: Parameters<FaceHandler>[0],
): Array<Record<string, unknown>> {
  return listFacePluginInventory(runtime).map((row) => {
    const cordisFailed = row.fiberPhase === "failed";
    const active = row.fiberPhase === "active";
    const hostPkg = hostPackageRecord(runtime, row.moduleName);
    return {
      pluginId: row.entryId,
      packageId: row.moduleName,
      fiberPhase: row.fiberPhase ?? (row.enabled ? "active" : "failed"),
      ...(hostPkg?.rpcChannels.length
        ? { rpcChannels: [...hostPkg.rpcChannels] }
        : {}),
      ...(active
        ? {
            hostBridge: "xrk-dsh-compat",
            note: BRIDGE_NOTE,
          }
        : {}),
      ...(cordisFailed
        ? {
            note: "kind:cordis host subprocess not started; install host.mjs or staged client.js for dsh-compat bridge.",
          }
        : {}),
    };
  });
}

function syncCordisHostApplied(
  runtime: Parameters<FaceHandler>[0],
  packageName: string,
): void {
  const hostPublic = runtime.hostPublic as
    | (NonNullable<typeof runtime.hostPublic> & { cordisHostApplied?: string[] })
    | undefined;
  if (!hostPublic) return;
  const name = packageName.trim();
  if (!name) return;
  const prev = hostPublic.cordisHostApplied ?? [];
  if (prev.includes(name)) return;
  hostPublic.cordisHostApplied = [...prev, name];
}

const STUBS: Record<string, FaceHandler> = {
  "dynamicCordisRunner/inventory": async (runtime) =>
    ok(inventoryFromRuntime(runtime)),
  "dynamicCordisRunner/syncInspectManifest": async (runtime, _rpcId, payload) => {
    const packageId =
      arg(payload, "packageId", 0) ||
      arg(payload, "pluginId", 1) ||
      arg(payload, "packageId", 3);
    const record = packageId ? hostPackageRecord(runtime, packageId) : undefined;
    return ok({
      packageId: packageId || null,
      manifest: record
        ? {
            packageName: record.packageName,
            rpcChannels: [...record.rpcChannels],
            hostBridge: "xrk-dsh-compat",
          }
        : null,
    });
  },
  "dynamicCordisRunner/reportRenderFailure": async () => ok(null),
  "dynamicCordisRunner/reportClientGuardFailure": async () => ok(null),
  "dynamicCordisRunner/resolveInspectQuery": async (runtime, _rpcId, payload) => {
    const packageId = arg(payload, "packageId", 0) || arg(payload, "pluginId", 1);
    return ok({
      accepted: packageId
        ? isCordisBridgedForInvoke(runtime, packageId, packageId)
        : false,
      packageId: packageId || null,
    });
  },
  "dynamicCordisRunner/resolveRequestRun": async (runtime, _rpcId, payload) => {
    const packageId = arg(payload, "packageId", 0) || arg(payload, "pluginId", 1);
    const accepted = packageId
      ? isCordisBridgedForInvoke(runtime, packageId, packageId)
      : false;
    return ok({
      accepted,
      packageId: packageId || null,
      ...(accepted ? { hostBridge: "xrk-dsh-compat" } : {}),
    });
  },
  "dynamicCordisRunner/stopFromPanel": async (runtime, _rpcId, payload) => {
    const packageId = arg(payload, "pluginId", 1) || arg(payload, "packageId", 3);
    if (packageId && isCordisBridgedForInvoke(runtime, packageId, packageId)) {
      await runtime.cordisHostBridge?.stopHostHalf?.(packageId);
      return ok({
        ok: true,
        stopped: true,
        packageId,
        hostBridge: "xrk-dsh-compat",
        note: BRIDGE_NOTE,
      });
    }
    return ok({ ok: false, reason: "not-running", message: BRIDGE_NOTE });
  },
  "dynamicCordisRunner/undefineFromPanel": async (runtime, _rpcId, payload) => {
    const packageId = arg(payload, "pluginId", 1) || arg(payload, "packageId", 3);
    if (!packageId) {
      return ok({ ok: false, reason: "plugin-missing", message: BRIDGE_NOTE });
    }
    return ok({
      ok: isCordisBridgedForInvoke(runtime, packageId, packageId),
      packageId,
      hostBridge: "xrk-dsh-compat",
      message: BRIDGE_NOTE,
    });
  },
  "dynamicCordisRunner/invoke": async (runtime, _rpcId, payload) => {
    const pluginId = arg(payload, "pluginId", 1) || "unknown";
    const packageId = arg(payload, "packageId", 3) || pluginId;
    const rpcCall = parseInvokeRpc(payload);
    const bridge = runtime.cordisHostBridge?.invokeRpc;
    if (rpcCall && bridge && isCordisBridgedForInvoke(runtime, pluginId, packageId)) {
      const channel =
        rpcCall.channel ??
        hostPackageRecord(runtime, packageId)?.rpcChannels[0] ??
        hostPackageRecord(runtime, pluginId)?.rpcChannels[0];
      if (channel) {
        try {
          const value = await bridge(channel, rpcCall.endpoint, rpcCall.rpcPayload);
          return ok({
            ok: true,
            pluginId,
            packageId,
            channel,
            endpoint: rpcCall.endpoint,
            value,
            appliedVia: "xrk-dsh-compat",
            hostBridge: true,
            rpcForwarded: true,
          });
        } catch (err) {
          return ok({
            ok: false,
            code: "rpc-forward-failed",
            message: err instanceof Error ? err.message : String(err),
            pluginId,
            packageId,
            channel,
            endpoint: rpcCall.endpoint,
          });
        }
      }
    }
    if (isCordisBridgedForInvoke(runtime, pluginId, packageId)) {
      const hostApplied = (runtime.hostPublic?.cordisHostApplied ?? []).some(
        (name) => name === pluginId || name === packageId,
      );
      return ok({
        ok: true,
        pluginId,
        packageId,
        appliedVia: "xrk-dsh-compat",
        hostBridge: true,
        ...(hostApplied ? { hostApplied: true } : { stagedClient: true }),
        bridges: [...BRIDGES],
      });
    }
    return ok({
      ok: false,
      code: "fiber-unavailable",
      message: BRIDGE_NOTE,
      pluginId,
      packageId,
      appliedVia: "xrk-dsh-compat",
      bridges: [...BRIDGES],
    });
  },
  "dynamicCordisRunner/getClientCode": async (runtime, _rpcId, payload) => {
    const pluginId = arg(payload, "pluginId", 1) || "unknown";
    const pluginRunId = arg(payload, "pluginRunId", 2) || "unknown";
    const packageId =
      arg(payload, "packageId", 3) || pluginId;
    const pluginsDir = runtime.hostPublic?.pluginsDir;
    const staged = readStagedClientCode(pluginsDir, packageId);
    return ok({
      code: staged.code,
      name: staged.name,
      pluginId,
      packageId,
      pluginRunId,
      ...(staged.code ? { staged: true } : { staged: false }),
    });
  },
  "dynamicCordisRunner/runHostHalf": async (runtime, _rpcId, payload) => {
    const packageId =
      arg(payload, "packageId", 0) ||
      arg(payload, "pluginId", 1) ||
      arg(payload, "packageId", 3);
    if (!packageId) {
      return ok({
        ok: false,
        reason: "missing-package",
        message: "packageId required",
      });
    }
    if (isCordisBridgedForInvoke(runtime, packageId, packageId)) {
      return ok({
        ok: true,
        appliedVia: "xrk-dsh-compat",
        packageId,
        hostBridge: true,
        bridges: [...BRIDGES],
      });
    }
    const bridge = runtime.cordisHostBridge?.applyHostHalf;
    if (bridge) {
      const result = await bridge(packageId);
      if (result.ok) {
        syncCordisHostApplied(runtime, packageId);
        return ok({
          ok: true,
          appliedVia: "xrk-dsh-compat",
          packageId,
          hostBridge: true,
          bridges: [...BRIDGES],
        });
      }
      return ok({
        ok: false,
        reason: "apply-failed",
        message: result.message ?? BRIDGE_NOTE,
        packageId,
      });
    }
    return ok({
      ok: false,
      reason: "bridge-unavailable",
      message: BRIDGE_NOTE,
      packageId,
      bridges: [...BRIDGES],
    });
  },
  "dynamicCordisRunner/settleUserRun": async (runtime, _rpcId, payload) => {
    const packageId = arg(payload, "packageId", 0) || arg(payload, "pluginId", 1);
    if (packageId && isCordisBridgedForInvoke(runtime, packageId, packageId)) {
      return ok({
        ok: true,
        settled: true,
        packageId,
        hostBridge: "xrk-dsh-compat",
      });
    }
    return ok({
      ok: false,
      reason: "rejected",
      message: BRIDGE_NOTE,
    });
  },
};

export function cordisRunnerHandler(method: string): FaceHandler | undefined {
  return STUBS[method];
}
