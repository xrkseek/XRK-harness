/**
 * Process-wide dsh-compat Cordis registry — shared by prewarm, HTTP handler, Face invoke.
 */
import type { DshAdapterContribution, DshCompatWireOptions } from "./adapter-types.js";
import {
  createCordisCompatRegistry,
  type CordisCompatRegistry,
} from "./cordis-registry.js";
import {
  installAdapterContributions,
  installComposedAdapters,
} from "./adapter-compose.js";
import { resetDshCompatUpgrades } from "./dsh-compat-upgrades.js";
import { configureImGatewayLocalWs } from "./im-gateway-local-ws.js";
import { resetHostApplyRegistry } from "./host-apply-registry.js";
import { resetLiveHostApply } from "./live-host-apply.js";
import { normalizeDshCompatWireCtx } from "./wire-normalize.js";

function installKey(ctx: DshCompatWireOptions): string {
  return [ctx.pluginsDir ?? "", ctx.xrkHome ?? "", ctx.workspaceRoot ?? ""].join(
    "|",
  );
}

let bootKey: string | undefined;
let bootPromise: Promise<CordisCompatRegistry> | undefined;
/** Set while compose runs so late HTTP can register without awaiting bootPromise. */
let activeRegistry: CordisCompatRegistry | undefined;

export function resetDshCompatRegistryCache(): void {
  bootKey = undefined;
  bootPromise = undefined;
  activeRegistry = undefined;
  resetHostApplyRegistry();
  resetLiveHostApply();
}

/**
 * Register an HTTP handler on the in-flight / live dsh-compat registry.
 * Safe during compose (avoids awaiting the same bootPromise — deadlock).
 */
export function registerDshCompatHttpLate(
  match: (pathname: string) => boolean,
  handle: Parameters<CordisCompatRegistry["registerHttp"]>[1],
): boolean {
  if (!activeRegistry) return false;
  activeRegistry.registerHttp(match, handle);
  return true;
}

export async function ensureDshCompatRegistry(
  ctx: DshCompatWireOptions,
): Promise<CordisCompatRegistry> {
  const normalized = normalizeDshCompatWireCtx(ctx);
  const key = installKey(normalized);
  if (bootPromise && bootKey === key) {
    return bootPromise;
  }
  bootKey = key;
  bootPromise = (async () => {
    resetDshCompatUpgrades();
    resetHostApplyRegistry();
    resetLiveHostApply();
    const registry = createCordisCompatRegistry();
    activeRegistry = registry;
    await installComposedAdapters(registry, normalized);
    configureImGatewayLocalWs({
      ...(normalized.xrkHome ? { xrkHome: normalized.xrkHome } : {}),
    });
    return registry;
  })();
  return bootPromise;
}

export async function appendDshCompatContribution(
  ctx: DshCompatWireOptions,
  contribution: DshAdapterContribution,
): Promise<CordisCompatRegistry> {
  const registry = await ensureDshCompatRegistry(ctx);
  installAdapterContributions(registry, [contribution]);
  return registry;
}

export async function invokeDshCompatRpc(
  ctx: DshCompatWireOptions,
  channel: string,
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const registry = await ensureDshCompatRegistry(ctx);
  return registry.invokeRpc(channel, endpoint, payload);
}
