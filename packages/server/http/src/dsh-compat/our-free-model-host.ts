/**
 * Load staged `dsh-our-free-model` Cordis host half and bridge
 * `llm.registerAdapter` → Face `llm-pi-ai` via the plugin's OpenAI forward listener.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  enrichCommunityModelsWithResolve,
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

const OFM_PACKAGE = "dsh-our-free-model";
const OFM_DATA_DIR = "our-free-model";
const OFM_API_PREFIX = "/api/our-free-model";
/** Channel-pack management RPC + captcha carrier (vendored pack registers here). */
const OFM_CHANNEL_PACK_PREFIX = "/api/channel-pack";

const DISPLAY_NAMES: Record<string, string> = {
  "our-free-model": "Our Free Model",
  "our-free-model-region": "Our Free Model · region-limited",
};

export function isOurFreeModelPackage(packageName: string): boolean {
  return packageName.trim() === OFM_PACKAGE;
}

export function hasOurFreeModelEntry(pkgRoot: string): boolean {
  return existsSync(path.join(pkgRoot, "index.js"));
}

interface OfmApplyModule {
  apply?: (ctx: Context, config?: Record<string, unknown>) => void;
}

/** OFM listModels has no baseUrl; Face sync uses the OpenAI forward listener. */
function forwardEndpointFromHome(dshHome: string): {
  baseUrl?: string;
  apiKey?: string;
} {
  const file = path.join(dshHome, OFM_DATA_DIR, "settings.json");
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      forward?: { port?: unknown; host?: unknown; enabled?: unknown };
      forwardKey?: unknown;
    };
    const port = Number(raw.forward?.port);
    if (!Number.isFinite(port) || port < 1) return {};
    const host =
      typeof raw.forward?.host === "string" && raw.forward.host.trim()
        ? raw.forward.host.trim()
        : "127.0.0.1";
    const key =
      typeof raw.forwardKey === "string" && raw.forwardKey.trim()
        ? raw.forwardKey.trim()
        : undefined;
    return {
      baseUrl: `http://${host}:${Math.trunc(port)}/v1`.replace(/\/+$/, ""),
      ...(key ? { apiKey: key } : {}),
    };
  } catch {
    return {};
  }
}

/** Ensure forward is on so Face can reach models over OpenAI-compatible HTTP. */
function ensureForwardSeed(dshHome: string): void {
  const dir = path.join(dshHome, OFM_DATA_DIR);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "settings.json");
  let current: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        current = parsed as Record<string, unknown>;
      }
    } catch {
      current = {};
    }
  }
  const forward =
    current.forward && typeof current.forward === "object"
      ? { ...(current.forward as Record<string, unknown>) }
      : {};
  writeFileSync(
    file,
    JSON.stringify(
      {
        ...current,
        version: current.version ?? 1,
        enabled: current.enabled !== false,
        exposeRegionModels: current.exposeRegionModels !== false,
        forward: {
          host: "127.0.0.1",
          port: 0,
          ...forward,
          enabled: true,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

/**
 * Apply staged Our Free Model host half. Returns HTTP contribution for dsh-compat.
 */
export async function tryApplyOurFreeModelHost(
  pkgRoot: string,
  packageName: string,
  wire: DshCompatWireOptions,
): Promise<DshAdapterContribution | undefined> {
  if (!isOurFreeModelPackage(packageName) || !hasOurFreeModelEntry(pkgRoot)) {
    return undefined;
  }

  ensureHostModuleRemap();

  const dshHome = resolveCompatHome(wire.xrkHome);
  process.env.DSH_HOME = dshHome;
  ensureForwardSeed(dshHome);

  const http: Array<{
    match: (pathname: string) => boolean;
    handle: CordisHttpHandler;
  }> = [];
  const rpc: Record<string, CordisRpcHandler> = {};
  const disposers: Array<() => void | Promise<void>> = [];
  /**
   * After fiber await we seal: further connection.fetch.register must late-bind
   * onto the live Cordis registry (OFM mounts channel-pack via void import().then).
   */
  let httpSealed = false;

  const root = new Context();
  const logger = {
    info: (...args: unknown[]) => console.info(`[${OFM_PACKAGE}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${OFM_PACKAGE}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${OFM_PACKAGE}]`, ...args),
  };

  root.logger.exporter({
    colors: false,
    export(message) {
      const line = `[${OFM_PACKAGE}] ${message.type} ${message.name}: ${message.args.map(String).join(" ")}`;
      if (message.type === "error") console.error(line);
      else if (message.type === "warn") console.warn(line);
      else console.info(line);
    },
  });

  const adapterSyncers: Array<() => Promise<boolean>> = [];
  let syncChain: Promise<void> = Promise.resolve();
  let hostDisposed = false;
  const syncedFingerprints = new Set<string>();
  /** Survives brief settings.json rewrites while forward rebinds (port:0 window). */
  let lastForward: { baseUrl?: string; apiKey?: string } = {};

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

  (root as { on: (event: string, listener: () => void) => unknown }).on(
    "llm/adapters-updated",
    () => {
      void runAllAdapterSyncers();
    },
  );

  root.provide("llm", {
    registerAdapter(
      providers: string[],
      adapter: {
        listModels?: (provider: string) => Promise<readonly unknown[]>;
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
        let anyOk = false;
        const fromDisk = forwardEndpointFromHome(dshHome);
        if (fromDisk.baseUrl) {
          lastForward = {
            baseUrl: fromDisk.baseUrl,
            ...(fromDisk.apiKey ? { apiKey: fromDisk.apiKey } : lastForward.apiKey
              ? { apiKey: lastForward.apiKey }
              : {}),
          };
        }
        const forward = {
          baseUrl: fromDisk.baseUrl ?? lastForward.baseUrl,
          apiKey: fromDisk.apiKey ?? lastForward.apiKey,
        };
        for (const providerId of ids) {
          try {
            const listed = (await adapter.listModels?.(providerId)) ?? [];
            const models = await enrichCommunityModelsWithResolve(
              adapter,
              providerId,
              asCommunityLlmModelRows(listed),
            );
            const baseUrl =
              baseUrlFromCommunityModels(listed) ??
              forward.baseUrl ??
              undefined;
            if (!baseUrl || models.length === 0) {
              logger.warn(
                `syncCommunityLlmProvider skip ${providerId}: baseUrl=${baseUrl ?? "none"} models=${models.length} listed=${listed.length}`,
              );
              continue;
            }
            // c2: fingerprint includes effort menus so resolveModel enrichment re-syncs.
            const fingerprint = `${providerId}|${baseUrl}|${models
              .map((m) =>
                `${m.id}:${m.reasoning?.efforts.map((e) => e.id).join("/") ?? ""}`,
              )
              .join(",")}|c2`;
            if (syncedFingerprints.has(fingerprint)) {
              anyOk = true;
              continue;
            }
            const apiKey =
              (await adapter.resolveApiKey?.())?.trim() ||
              forward.apiKey ||
              `xrk-${providerId}`;
            await wire.syncCommunityLlmProvider({
              providerId,
              displayName: DISPLAY_NAMES[providerId] ?? providerId,
              baseUrl,
              apiKey,
              models,
            });
            lastForward = { baseUrl, apiKey };
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
          ids.splice(
            0,
            ids.length,
            ...next.map((p) => p.trim()).filter(Boolean),
          );
          syncedFingerprints.clear();
          void runAllAdapterSyncers();
        },
      });
    },
    registerConfigurableProviders() {
      /* Face Settings cards are separate; no-op stub */
    },
    registerModelDiscovery() {
      /* optional DSH probe button */
    },
  });

  root.provide("webServer", {
    register(route: XrkWebServerRoute) {
      pushCordisWebServerRoute(http, route);
      return () => undefined;
    },
    registerUpgrade() {
      /* OFM events are SSE over HTTP unary register */
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

  root.provide("settings", {
    installSection() {
      return () => undefined;
    },
    async update() {
      return undefined;
    },
  });

  // Channel-pack injects credentials + commands; persist OAuth JSON under xrkHome.
  root.provide(
    "credentials",
    createCordisCredentialsBridge(dshHome, packageName),
  );
  root.provide("commands", {
    register() {
      return () => undefined;
    },
  });

  const originalEffect = root.effect.bind(root);
  root.effect = ((fn: Parameters<typeof root.effect>[0], label?: string) => {
    const owned = originalEffect(fn, label);
    disposers.push(() => {
      void owned();
    });
    return owned;
  }) as typeof root.effect;

  type AwaitableFiber = { await: () => Promise<unknown> };
  const childFibers: AwaitableFiber[] = [];
  const registryPlugin = root.registry.plugin.bind(root.registry);
  root.registry.plugin = ((plugin, config?, getOuterStack?) => {
    const fiber = registryPlugin(plugin, config, getOuterStack);
    childFibers.push(fiber);
    return fiber;
  }) as typeof root.registry.plugin;

  try {
    const entry = pathToFileURL(path.join(pkgRoot, "index.js")).href;
    const mod = (await import(/* @vite-ignore */ entry)) as OfmApplyModule;
    if (typeof mod.apply !== "function") return undefined;
    // managed: stand down self-updater / hot-reload writing into staged plugins.
    mod.apply(root, { distribution: "managed" });
    await Promise.all(childFibers.map((fiber) => fiber.await()));
  } catch (error) {
    logger.error("host apply failed", error);
    hostDisposed = true;
    for (const d of disposers.reverse()) await d();
    return undefined;
  }

  // Seal before return so async pack.apply → connection.fetch.register late-binds.
  httpSealed = true;
  scheduleCommunityLlmSyncRetries(runAllAdapterSyncers, () => hostDisposed);
  disposers.push(() => {
    hostDisposed = true;
  });

  for (const row of http) {
    const inner = row.handle;
    row.handle = async (req, res, pathname) => {
      const handled = await inner(req, res, pathname);
      if (
        handled &&
        syncedFingerprints.size === 0 &&
        pathname.startsWith(OFM_API_PREFIX) &&
        (req.method ?? "GET").toUpperCase() === "GET"
      ) {
        void runAllAdapterSyncers();
      }
      return handled;
    };
  }

  const httpPrefixes = [OFM_API_PREFIX];
  if (http.some((row) => row.match(OFM_CHANNEL_PACK_PREFIX))) {
    httpPrefixes.push(OFM_CHANNEL_PACK_PREFIX);
  }

  return {
    meta: {
      id: "dsh-our-free-model-host",
      package: packageName,
      httpPrefixes,
      rpcChannels: Object.keys(rpc),
      description: `${DSH_COMPAT_ADAPTER}: Our Free Model Cordis host half`,
    },
    ...(http.length ? { http } : {}),
    ...(Object.keys(rpc).length ? { rpc } : {}),
  };
}
