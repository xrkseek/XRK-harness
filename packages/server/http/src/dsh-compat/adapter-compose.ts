/**
 * Compose host adapters from installed plugins:
 * explicit `xrk.host.json` / package host fields, else DSH upstream presets.
 */
import { existsSync } from "node:fs";
import { readXrkPluginInventory } from "../xrk/plugin-services.js";
import type {
  CordisCompatRegistry,
  CordisRpcHandler,
} from "./cordis-registry.js";
import type {
  DshAdapterContribution,
  DshCompatWireOptions,
} from "./adapter-types.js";
import { XRK_HOST_PROVIDERS } from "./adapter-providers.js";
import { baselineHttpRoutes, baselineRpcRoutes } from "./dsh-path-capabilities.js";
import { configureSettingsFallback } from "./cordis-settings-fallback.js";
import {
  clientPluginRoot,
  resolvePluginHostManifest,
} from "./plugin-host-manifest.js";
import { composeApplyBridgeContributions } from "./host-apply-bridge.js";
import { registerHonestHttpCatchall } from "./honest-http-catchall.js";

interface MutableContribution {
  meta: {
    id: string;
    package?: string;
    httpPrefixes: string[];
    rpcChannels: string[];
  };
  rpc?: Record<string, CordisRpcHandler>;
  http?: DshAdapterContribution["http"];
}

function installAdapters(
  registry: CordisCompatRegistry,
  adapters: readonly DshAdapterContribution[],
): void {
  for (const adapter of adapters) {
    if (adapter.rpc) {
      for (const [channel, handler] of Object.entries(adapter.rpc)) {
        registry.registerRpc(channel, handler);
      }
    }
    if (adapter.http) {
      for (const row of adapter.http) {
        registry.registerHttp(row.match, row.handle);
      }
    }
  }
}

function mergeContribution(
  target: MutableContribution,
  partial: { http?: DshAdapterContribution["http"]; rpc?: DshAdapterContribution["rpc"] },
): void {
  if (partial.http?.length) {
    target.http = [...(target.http ?? []), ...partial.http];
  }
  if (partial.rpc) {
    target.rpc = { ...(target.rpc ?? {}), ...partial.rpc };
  }
}

async function composeBaselineCapabilities(
  ctx: DshCompatWireOptions,
): Promise<readonly DshAdapterContribution[]> {
  const http: Array<NonNullable<DshAdapterContribution["http"]>[number]> = [];
  const prefixes: string[] = [];
  const rpc: Record<string, CordisRpcHandler> = {};
  const rpcChannels: string[] = [];

  for (const route of baselineHttpRoutes()) {
    const provider = XRK_HOST_PROVIDERS[route.provider];
    if (!provider) {
      throw new Error(
        `dsh-baseline: unknown host provider "${route.provider}" for ${route.prefix}`,
      );
    }
    const partial = await provider(ctx, route, "", "dsh-baseline");
    if (partial.http?.length) {
      const rows = [...partial.http];
      http.splice(http.length, 0, ...rows);
      prefixes.push(route.prefix);
    }
  }

  for (const route of baselineRpcRoutes()) {
    const provider = XRK_HOST_PROVIDERS[route.provider];
    if (!provider) {
      throw new Error(
        `dsh-baseline: unknown host provider "${route.provider}" for RPC ${route.channel}`,
      );
    }
    const partial = await provider(ctx, route, "", "dsh-baseline");
    if (partial.rpc) {
      for (const [channel, handler] of Object.entries(partial.rpc)) {
        rpc[channel] = handler;
        rpcChannels.push(channel);
      }
    }
  }

  return [
    {
      meta: {
        id: "dsh-baseline",
        httpPrefixes: prefixes,
        rpcChannels,
      },
      ...(http.length ? { http } : {}),
      ...(Object.keys(rpc).length ? { rpc } : {}),
    },
  ];
}

export async function composeAdaptersFromInventory(
  ctx: DshCompatWireOptions,
): Promise<readonly DshAdapterContribution[]> {
  const inventory = readXrkPluginInventory(ctx);
  const byId = new Map<string, MutableContribution>();

  for (const pkg of inventory.packages) {
    const root = clientPluginRoot(inventory.pluginsDir, pkg.name);
    if (!existsSync(root)) continue;
    const manifest = resolvePluginHostManifest(root, pkg.name);
    if (!manifest) continue;

    const adapterId =
      manifest.id ?? pkg.name.replace(/^@/, "").replace(/\//g, "-");

    let contribution = byId.get(adapterId);
    if (!contribution) {
      contribution = {
        meta: {
          id: adapterId,
          package: pkg.name,
          httpPrefixes: [],
          rpcChannels: [],
        },
      };
      byId.set(adapterId, contribution);
    }

    for (const route of manifest.http ?? []) {
      const provider = XRK_HOST_PROVIDERS[route.provider];
      if (!provider) {
        throw new Error(
          `${pkg.name}: unknown host provider "${route.provider}" for HTTP ${route.prefix}`,
        );
      }
      const partial = await provider(ctx, route, root, pkg.name);
      mergeContribution(contribution, partial);
      if (!contribution.meta.httpPrefixes.includes(route.prefix)) {
        contribution.meta.httpPrefixes.push(route.prefix);
      }
    }

    for (const route of manifest.rpc ?? []) {
      const provider = XRK_HOST_PROVIDERS[route.provider];
      if (!provider) {
        throw new Error(
          `${pkg.name}: unknown host provider "${route.provider}" for RPC ${route.channel}`,
        );
      }
      const partial = await provider(ctx, route, root, pkg.name);
      mergeContribution(contribution, partial);
      if (!contribution.meta.rpcChannels.includes(route.channel)) {
        contribution.meta.rpcChannels.push(route.channel);
      }
    }
  }

  return [...byId.values()].map(
    (row): DshAdapterContribution => ({
      meta: row.meta,
      ...(row.http ? { http: row.http } : {}),
      ...(row.rpc ? { rpc: row.rpc } : {}),
    }),
  );
}

export function installAdapterContributions(
  registry: CordisCompatRegistry,
  adapters: readonly DshAdapterContribution[],
): void {
  installAdapters(registry, adapters);
}

export async function installComposedAdapters(
  registry: CordisCompatRegistry,
  ctx: DshCompatWireOptions,
): Promise<void> {
  configureSettingsFallback({
    ...(ctx.xrkHome ? { xrkHome: ctx.xrkHome } : {}),
  });
  installAdapters(registry, await composeBaselineCapabilities(ctx));
  installAdapters(registry, await composeAdaptersFromInventory(ctx));
  installAdapters(registry, await composeApplyBridgeContributions(ctx));
  registerHonestHttpCatchall(registry);
}
