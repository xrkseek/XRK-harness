/**
 * Load staged `dsh-workbuddy-connect` Cordis host half and bridge
 * `llm.registerAdapter` → Face `llm-pi-ai` + credentials.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Context } from "@xrkseek/cordis";
import type {
  DshAdapterContribution,
  DshCompatWireOptions,
} from "./adapter-types.js";
import {
  createCordisConnectionBridge,
  pushCordisWebServerRoute,
} from "./cordis-connection-bridge.js";
import { createCordisCredentialsBridge } from "./cordis-credentials-bridge.js";
import {
  asCommunityLlmModelRows,
  baseUrlFromCommunityModels,
  scheduleCommunityLlmSyncRetries,
} from "./community-llm-host-sync.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { ensureHostModuleRemap } from "./host-module-remap.js";
import type {
  CordisHttpHandler,
  CordisRpcHandler,
} from "./cordis-registry.js";
import { resolveCompatHome } from "./underlying/json-store.js";
import type { XrkWebServerRoute } from "./xrk-host-apply.js";

const WORKBUDDY_PACKAGE = "dsh-workbuddy-connect";

export function isWorkBuddyConnectPackage(packageName: string): boolean {
  return packageName.trim() === WORKBUDDY_PACKAGE;
}

export function hasWorkBuddyHostLib(pkgRoot: string): boolean {
  return existsSync(path.join(pkgRoot, "lib", "index.js"));
}

interface WorkBuddyApplyModule {
  apply?: (ctx: Context, config?: Record<string, unknown>) => void;
  Config?: unknown;
}

/** WorkBuddy hides the catalog until credentials exist; peek fallback for Face sync. */
async function listModelsForSync(
  adapter: {
    listModels?: (provider: string) => Promise<readonly unknown[]>;
    catalog?: {
      isVisible?: () => boolean;
      setVisible?: (visible: boolean) => unknown;
    };
  },
  providerId: string,
): Promise<readonly unknown[]> {
  const listed = (await adapter.listModels?.(providerId)) ?? [];
  if (listed.length > 0) return listed;
  const catalog = adapter.catalog;
  if (!catalog?.setVisible || !catalog.isVisible) return listed;
  const wasVisible = catalog.isVisible();
  if (wasVisible) return listed;
  catalog.setVisible(true);
  try {
    return (await adapter.listModels?.(providerId)) ?? [];
  } finally {
    catalog.setVisible(wasVisible);
  }
}

/**
 * Apply staged WorkBuddy host half. Returns HTTP/RPC contribution for dsh-compat.
 */
export async function tryApplyWorkBuddyHost(
  pkgRoot: string,
  packageName: string,
  wire: DshCompatWireOptions,
): Promise<DshAdapterContribution | undefined> {
  if (!isWorkBuddyConnectPackage(packageName) || !hasWorkBuddyHostLib(pkgRoot)) {
    return undefined;
  }

  ensureHostModuleRemap();

  const http: Array<{
    match: (pathname: string) => boolean;
    handle: CordisHttpHandler;
  }> = [];
  const rpc: Record<string, CordisRpcHandler> = {};
  const disposers: Array<() => void | Promise<void>> = [];

  const root = new Context();
  const logger = {
    info: (...args: unknown[]) => console.info("[dsh-workbuddy-connect]", ...args),
    warn: (...args: unknown[]) => console.warn("[dsh-workbuddy-connect]", ...args),
    error: (...args: unknown[]) => console.error("[dsh-workbuddy-connect]", ...args),
  };

  // WorkBuddy uses Cordis ctx.logger.*; default exporter only buffers — mirror to console.
  root.logger.exporter({
    colors: false,
    export(message) {
      const line = `[dsh-workbuddy-connect] ${message.type} ${message.name}: ${message.args.map(String).join(" ")}`;
      if (message.type === "error") console.error(line);
      else if (message.type === "warn") console.warn(line);
      else console.info(line);
    },
  });

  const adapterSyncers: Array<() => Promise<boolean>> = [];
  let syncChain: Promise<void> = Promise.resolve();
  let hostDisposed = false;
  const syncedFingerprints = new Set<string>();
  /** Per-provider last good loopback baseUrl (shim port can briefly vanish). */
  const lastBaseUrlByProvider = new Map<string, string>();

  const runAllAdapterSyncers = async (): Promise<void> => {
    syncChain = syncChain
      .then(async () => {
        if (hostDisposed) return;
        for (const sync of adapterSyncers) {
          await sync();
        }
      })
      .catch((error) => {
        logger.warn("adapter sync batch failed", error);
      });
    await syncChain;
  };

  // WorkBuddy emits this community event; Cordis Events map has no ambient key here.
  (root as { on: (event: string, listener: () => void) => unknown }).on(
    "llm/adapters-updated",
    () => {
      void runAllAdapterSyncers();
    },
  );

  root.provide("llm", {
    registerAdapter(providers: string[], adapter: {
      listModels?: (provider: string) => Promise<readonly unknown[]>;
      resolveApiKey?: () => Promise<string | undefined>;
      catalog?: {
        isVisible?: () => boolean;
        setVisible?: (visible: boolean) => unknown;
      };
    }) {
      const ids = providers.map((p) => p.trim()).filter(Boolean);
      let disposed = false;
      const sync = async (): Promise<boolean> => {
        if (disposed || hostDisposed || !wire.syncCommunityLlmProvider) {
          return false;
        }
        let anyOk = false;
        for (const providerId of ids) {
          try {
            const listed = await listModelsForSync(adapter, providerId);
            const models = asCommunityLlmModelRows(listed);
            const baseUrl =
              baseUrlFromCommunityModels(listed) ??
              lastBaseUrlByProvider.get(providerId);
            if (!baseUrl || models.length === 0) {
              logger.warn(
                `syncCommunityLlmProvider skip ${providerId}: baseUrl=${baseUrl ?? "none"} models=${models.length} listed=${listed.length}`,
              );
              continue;
            }
            // `c1`: re-sync once so Face merge can fill softBudgetMaxTokens.
            const fingerprint = `${providerId}|${baseUrl}|${models.map((m) => m.id).join(",")}|c1`;
            if (syncedFingerprints.has(fingerprint)) {
              anyOk = true;
              continue;
            }
            const apiKey =
              (await adapter.resolveApiKey?.())?.trim() ||
              `xrk-workbuddy-${providerId}`;
            await wire.syncCommunityLlmProvider({
              providerId,
              displayName:
                providerId === "workbuddy-ai" ? "WorkBuddy AI" : "WorkBuddy",
              baseUrl,
              apiKey,
              models,
            });
            lastBaseUrlByProvider.set(providerId, baseUrl);
            syncedFingerprints.add(fingerprint);
            anyOk = true;
            logger.info(
              `syncCommunityLlmProvider ok ${providerId} models=${models.length} baseUrl=${baseUrl}`,
            );
          } catch (error) {
            logger.warn(
              `syncCommunityLlmProvider failed for ${providerId}`,
              error,
            );
          }
        }
        return anyOk;
      };
      adapterSyncers.push(sync);
      void runAllAdapterSyncers();
      const release = (): void => {
        disposed = true;
      };
      return Object.assign(release, {
        replace(next: string[]) {
          ids.splice(0, ids.length, ...next.map((p) => p.trim()).filter(Boolean));
          syncedFingerprints.clear();
          void runAllAdapterSyncers();
        },
      });
    },
  });

  root.provide("webServer", {
    register(route: XrkWebServerRoute) {
      pushCordisWebServerRoute(http, route);
      return () => undefined;
    },
    registerUpgrade() {
      /* WorkBuddy status/probe are HTTP unary */
    },
    tapIndex() {
      return () => undefined;
    },
  });

  root.provide("rpc", {
    register(channel: string, handler: CordisRpcHandler) {
      const key = channel.endsWith("/") ? channel.slice(0, -1) : channel;
      rpc[key] = handler;
    },
  });

  let httpSealed = false;
  root.provide(
    "connection",
    createCordisConnectionBridge({
      http,
      isSealed: () => httpSealed,
      onLateMiss: (p) =>
        logger.warn(
          `late connection.fetch register missed active registry for ${p}`,
        ),
    }),
  );

  root.provide(
    "credentials",
    createCordisCredentialsBridge(resolveCompatHome(wire.xrkHome), packageName),
  );

  // WorkBuddy registers status/probe via ctx.inject(["settings"], …);
  // without installSection it only warns and skips — keep a no-op stub.
  root.provide("settings", {
    installSection(
      _ctx: unknown,
      _ns: string,
      _section: unknown,
      _config: unknown,
      _hooks?: unknown,
    ) {
      return () => undefined;
    },
    async update(_ns: string, _patch: unknown) {
      return undefined;
    },
  });

  // Patch effect onto context for cleanup registration from apply().
  const originalEffect = root.effect.bind(root);
  root.effect = ((fn: Parameters<typeof root.effect>[0], label?: string) => {
    const owned = originalEffect(fn, label);
    disposers.push(() => {
      void owned();
    });
    return owned;
  }) as typeof root.effect;

  // Cordis inject(["webServer"], …) schedules apply on a microtask; await
  // those fibers so webServer.register has run before we return http[].
  type AwaitableFiber = { await: () => Promise<unknown> };
  const childFibers: AwaitableFiber[] = [];
  const registryPlugin = root.registry.plugin.bind(root.registry);
  root.registry.plugin = ((plugin, config?, getOuterStack?) => {
    const fiber = registryPlugin(plugin, config, getOuterStack);
    childFibers.push(fiber);
    return fiber;
  }) as typeof root.registry.plugin;

  try {
    const entry = pathToFileURL(path.join(pkgRoot, "lib", "index.js")).href;
    const mod = (await import(/* @vite-ignore */ entry)) as WorkBuddyApplyModule;
    if (typeof mod.apply !== "function") return undefined;
    mod.apply(root, {});
    await Promise.all(childFibers.map((fiber) => fiber.await()));
  } catch (error) {
    logger.error("host apply failed", error);
    hostDisposed = true;
    for (const d of disposers.reverse()) await d();
    return undefined;
  }

  httpSealed = true;

  // Identity/catalog hydrate is async inside WorkBuddy; first registerAdapter
  // sync often skips. Retries cover boot-with-saved-credentials without waiting
  // solely on llm/adapters-updated delivery.
  scheduleCommunityLlmSyncRetries(runAllAdapterSyncers, () => hostDisposed);
  disposers.push(() => {
    hostDisposed = true;
  });

  // Until the first Face sync sticks, status polls (post-login) re-nudge.
  // After that, fingerprint short-circuit keeps this cheap.
  for (const row of http) {
    const inner = row.handle;
    row.handle = async (req, res, pathname) => {
      const handled = await inner(req, res, pathname);
      if (
        handled &&
        syncedFingerprints.size === 0 &&
        /\/status\/?$/i.test(pathname) &&
        (req.method ?? "GET").toUpperCase() === "GET"
      ) {
        void runAllAdapterSyncers();
      }
      return handled;
    };
  }

  return {
    meta: {
      id: "dsh-workbuddy-connect-host",
      package: packageName,
      httpPrefixes: [
        "/plugins/dsh-workbuddy-connect/",
      ],
      rpcChannels: Object.keys(rpc),
      description: `${DSH_COMPAT_ADAPTER}: WorkBuddy Cordis host half`,
    },
    ...(http.length ? { http } : {}),
    ...(Object.keys(rpc).length ? { rpc } : {}),
  };
}
