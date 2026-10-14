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
  communityLlmSyncFingerprint,
  createCommunityLlmSyncScheduler,
  dropStaleCommunityLlmFingerprints,
  enrichCommunityModelsWithResolve,
} from "./community-llm-host-sync.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { ensureHostModuleRemap } from "./host-module-remap.js";
import type {
  CordisHttpHandler,
  CordisRpcHandler,
} from "./cordis-registry.js";
import { resolveCompatHome } from "./underlying/json-store.js";
import type { XrkWebServerRoute } from "./xrk-host-apply.js";
import {
  gateLiveHostHttp,
  gateLiveHostRpc,
  registerLiveHostApply,
} from "./live-host-apply.js";

const WORKBUDDY_PACKAGE = "dsh-workbuddy-connect";
/** Plugin env that skips Windows registry discovery for the international app. */
const WORKBUDDY_AI_ELECTRON_BIN = "WORKBUDDY_AI_ELECTRON_BIN";

export function isWorkBuddyConnectPackage(packageName: string): boolean {
  return packageName.trim() === WORKBUDDY_PACKAGE;
}

export function hasWorkBuddyHostLib(pkgRoot: string): boolean {
  return existsSync(path.join(pkgRoot, "lib", "index.js"));
}

/**
 * Hint WorkBuddy AI's Electron binary when the plugin's Windows registry
 * discovery cannot finish (non-ASCII uninstall trees force a PowerShell
 * fallback that exits incomplete on some machines). CN already has a
 * LocalAppData default path; international is registry-only in the plugin.
 *
 * Never overrides an explicit `WORKBUDDY_AI_ELECTRON_BIN`. Only the verified
 * installer layout `LOCALAPPDATA\\Programs\\WorkBuddyAI\\WorkBuddyAI.exe`.
 */
export function ensureWorkBuddyAiElectronBin(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const existing = env[WORKBUDDY_AI_ELECTRON_BIN]?.trim();
  if (existing) return existing;
  if (platform !== "win32") return undefined;
  const localAppData = env.LOCALAPPDATA?.trim();
  if (!localAppData) return undefined;
  const installRoot = path.join(localAppData, "Programs", "WorkBuddyAI");
  const electronPath = path.join(installRoot, "WorkBuddyAI.exe");
  if (!existsSync(electronPath)) return undefined;
  if (!existsSync(path.join(installRoot, "resources", "app.asar"))) {
    return undefined;
  }
  if (!existsSync(path.join(installRoot, "version"))) return undefined;
  env[WORKBUDDY_AI_ELECTRON_BIN] = electronPath;
  return electronPath;
}

interface WorkBuddyApplyModule {
  apply?: (ctx: Context, config?: Record<string, unknown>) => void;
  Config?: unknown;
}

type WorkBuddySyncCatalog = {
  isVisible?: () => boolean;
  setVisible?: (visible: boolean) => unknown;
  /** Full roster while visible (credential gate). */
  current?: () => readonly unknown[];
  /** Same roster ignoring visibility (boot / signed-out peek). */
  fallback?: () => readonly unknown[];
};

type WorkBuddySyncAdapter = {
  listModels?: (provider: string) => Promise<readonly unknown[]>;
  catalog?: WorkBuddySyncCatalog;
};

/**
 * Snapshot models for Face sync.
 *
 * WorkBuddy's `listModels` hides per-account disabled ids and returns [] while
 * `catalog` is credential-gated off — both leave Face on a stale/partial
 * `llm-pi-ai` row (wrong loopback port after OFM/WB port reshuffle, or "half"
 * the roster). Prefer `catalog.current` / `fallback` with the live shim
 * `baseUrl` from a filtered listModels peek.
 */
export async function listModelsForSync(
  adapter: WorkBuddySyncAdapter,
  providerId: string,
): Promise<readonly unknown[]> {
  const catalog = adapter.catalog;
  const wasVisible = catalog?.isVisible?.();
  const peeked =
    catalog?.setVisible !== undefined &&
    typeof wasVisible === "boolean" &&
    wasVisible === false;
  if (peeked) catalog!.setVisible!(true);
  try {
    const listed = (await adapter.listModels?.(providerId)) ?? [];
    const baseUrl = baseUrlFromCommunityModels(listed);
    const current = catalog?.current?.() ?? [];
    const full = current.length > 0 ? current : (catalog?.fallback?.() ?? []);
    if (full.length === 0) return listed;
    return full.map((info) => {
      if (!info || typeof info !== "object" || Array.isArray(info)) return info;
      if (!baseUrl) return info;
      const row = info as Record<string, unknown>;
      if (typeof row.baseUrl === "string" && row.baseUrl.trim()) return info;
      return { ...row, baseUrl };
    });
  } finally {
    if (peeked) catalog!.setVisible!(wasVisible!);
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
  const aiElectron = ensureWorkBuddyAiElectronBin();
  if (aiElectron) {
    console.info(
      "[dsh-workbuddy-connect] WORKBUDDY_AI_ELECTRON_BIN hint",
      aiElectron,
    );
  }

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

  let hostDisposed = false;
  /** Per-provider last good loopback baseUrl (shim port can briefly vanish). */
  const lastBaseUrlByProvider = new Map<string, string>();
  const syncScheduler = createCommunityLlmSyncScheduler({
    isDisposed: () => hostDisposed,
    onBatchError: (error) => logger.warn("adapter sync batch failed", error),
  });

  // WorkBuddy emits this community event; Cordis Events map has no ambient key here.
  (root as { on: (event: string, listener: () => void) => unknown }).on(
    "llm/adapters-updated",
    () => {
      void syncScheduler.runAll();
    },
  );

  root.provide("llm", {
    registerAdapter(
      providers: string[],
      adapter: WorkBuddySyncAdapter & {
        resolveModel?: (provider: string, model: string) => Promise<unknown>;
        resolveApiKey?: () => Promise<string | undefined>;
      },
    ) {
      const ids = providers.map((p) => p.trim()).filter(Boolean);
      let disposed = false;
      const sync = async (): Promise<boolean> => {
        if (disposed || hostDisposed || !wire.syncCommunityLlmProvider) {
          return false;
        }
        if (ids.length === 0) return true;
        let allOk = true;
        for (const providerId of ids) {
          try {
            const listed = await listModelsForSync(adapter, providerId);
            const models = await enrichCommunityModelsWithResolve(
              adapter,
              providerId,
              asCommunityLlmModelRows(listed),
            );
            const baseUrl =
              baseUrlFromCommunityModels(listed) ??
              lastBaseUrlByProvider.get(providerId);
            if (!baseUrl || models.length === 0) {
              allOk = false;
              logger.warn(
                `syncCommunityLlmProvider skip ${providerId}: baseUrl=${baseUrl ?? "none"} models=${models.length} listed=${listed.length}`,
              );
              continue;
            }
            const fingerprint = communityLlmSyncFingerprint(
              providerId,
              baseUrl,
              models,
            );
            dropStaleCommunityLlmFingerprints(
              syncScheduler.fingerprints,
              providerId,
              baseUrl,
            );
            if (syncScheduler.fingerprints.has(fingerprint)) {
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
            syncScheduler.fingerprints.add(fingerprint);
            logger.info(
              `syncCommunityLlmProvider ok ${providerId} models=${models.length} baseUrl=${baseUrl}`,
            );
          } catch (error) {
            allOk = false;
            logger.warn(
              `syncCommunityLlmProvider failed for ${providerId}`,
              error,
            );
          }
        }
        return allOk;
      };
      syncScheduler.addSyncer(sync);
      void syncScheduler.runAll();
      const release = (): void => {
        disposed = true;
        syncScheduler.markUnsettled();
      };
      return Object.assign(release, {
        replace(next: string[]) {
          ids.splice(0, ids.length, ...next.map((p) => p.trim()).filter(Boolean));
          syncScheduler.fingerprints.clear();
          syncScheduler.markUnsettled();
          void syncScheduler.runAll();
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
  syncScheduler.scheduleRetries();
  disposers.push(() => {
    hostDisposed = true;
  });

  // Until every variant has synced Face, status polls (post-login) re-nudge.
  // Do not stop after the first variant succeeds — CN/AI register separately,
  // and a settled AI fingerprint used to silence CN's stale baseURL forever.
  for (const row of http) {
    const inner = row.handle;
    row.handle = async (req, res, pathname) => {
      const handled = await inner(req, res, pathname);
      if (
        handled &&
        !syncScheduler.settled() &&
        /\/status\/?$/i.test(pathname) &&
        (req.method ?? "GET").toUpperCase() === "GET"
      ) {
        void syncScheduler.runAll();
      }
      return handled;
    };
  }

  await registerLiveHostApply(packageName, async () => {
    hostDisposed = true;
    for (const d of disposers.reverse()) await d();
    try {
      await root.fiber.dispose();
    } catch {
      /* Cordis root may already be torn down */
    }
  });

  const gatedHttp = gateLiveHostHttp(packageName, http);
  const gatedRpc = gateLiveHostRpc(packageName, rpc);

  return {
    meta: {
      id: "dsh-workbuddy-connect-host",
      package: packageName,
      httpPrefixes: [
        "/plugins/dsh-workbuddy-connect/",
      ],
      rpcChannels: Object.keys(gatedRpc),
      description: `${DSH_COMPAT_ADAPTER}: WorkBuddy Cordis host half`,
    },
    ...(gatedHttp.length ? { http: gatedHttp } : {}),
    ...(Object.keys(gatedRpc).length ? { rpc: gatedRpc } : {}),
  };
}
