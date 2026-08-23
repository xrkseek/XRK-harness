import type { FaceRuntime } from "./context.js";
import { readStagedClientCode } from "./handlers/staged-client-code.js";
import type { FacePluginFiberPhase } from "./plugin-inventory.js";

function isCordisHostApplied(
  runtime: Pick<FaceRuntime, "hostPublic">,
  ...ids: readonly string[]
): boolean {
  const applied = new Set(runtime.hostPublic?.cordisHostApplied ?? []);
  return ids.some((id) => id.trim() && applied.has(id.trim()));
}

function hasStagedCordisClient(
  runtime: Pick<FaceRuntime, "hostPublic">,
  ...ids: readonly string[]
): boolean {
  const pluginsDir = runtime.hostPublic?.pluginsDir;
  if (!pluginsDir?.trim()) return false;
  return ids.some((id) => {
    const trimmed = id.trim();
    return trimmed.length > 0 && readStagedClientCode(pluginsDir, trimmed).code.length > 0;
  });
}

/** Whether a `kind:cordis` process plugin is served via dsh-compat (not Cordis fiber). */
export function resolveCordisFiberState(
  runtime: Pick<FaceRuntime, "hostPublic" | "webPlugins">,
  pluginId: string,
): { readonly enabled: boolean; readonly fiberPhase: FacePluginFiberPhase } {
  const id = pluginId.trim();
  if (
    isCordisHostApplied(runtime, id) ||
    hasStagedCordisClient(runtime, id)
  ) {
    return { enabled: true, fiberPhase: "active" };
  }
  return { enabled: false, fiberPhase: "failed" };
}

export function isCordisBridgedForInvoke(
  runtime: Pick<FaceRuntime, "hostPublic" | "webPlugins">,
  pluginId: string,
  packageId: string,
): boolean {
  const ids = [pluginId, packageId].filter((x) => x.trim());
  return (
    isCordisHostApplied(runtime, ...ids) || hasStagedCordisClient(runtime, ...ids)
  );
}
