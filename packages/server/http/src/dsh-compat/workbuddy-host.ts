/**
 * Load staged `dsh-workbuddy-connect` Cordis host half and bridge
 * `llm.registerAdapter` → Face `llm-pi-ai` + credentials.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  DshAdapterContribution,
  DshCompatWireOptions,
} from "./adapter-types.js";
import { createCommunityCordisHostSession } from "./community-cordis-host-session.js";
import {
  createCommunityLoopbackLlmBridge,
  type CommunityLoopbackAdapter,
} from "./community-loopback-llm-bridge.js";
import {
  listModelsForCommunitySync,
} from "./community-llm-host-sync.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { ensureHostModuleRemap } from "./host-module-remap.js";
import { isPluginPackageFamily } from "./plugin-package-id.js";

const WORKBUDDY_PACKAGE = "dsh-workbuddy-connect";
/** Plugin env that skips Windows registry discovery for the international app. */
const WORKBUDDY_AI_ELECTRON_BIN = "WORKBUDDY_AI_ELECTRON_BIN";

export function isWorkBuddyConnectPackage(packageName: string): boolean {
  return isPluginPackageFamily(packageName, WORKBUDDY_PACKAGE);
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

type WorkBuddySyncAdapter = CommunityLoopbackAdapter;

/**
 * Snapshot models for Face sync (WorkBuddy catalog peek + fallback roster).
 * @see {@link listModelsForCommunitySync}
 */
export async function listModelsForSync(
  adapter: WorkBuddySyncAdapter,
  providerId: string,
  options?: { readonly lastBaseUrl?: string },
): Promise<readonly unknown[]> {
  return listModelsForCommunitySync(adapter, providerId, options);
}

/** Map catalog rows into the WB status `models` field shape. */
function statusModelsFromCatalog(
  rows: readonly unknown[],
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const o = row as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!id) continue;
    const name =
      typeof o.name === "string" && o.name.trim() ? o.name.trim() : undefined;
    const contextWindow =
      typeof o.contextWindow === "number" &&
      Number.isFinite(o.contextWindow) &&
      o.contextWindow > 0
        ? o.contextWindow
        : undefined;
    out.push({
      id,
      ...(name !== undefined ? { name } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
    });
  }
  return out;
}

/**
 * When signed-in but `catalog.current()` is still gated empty, fill status
 * `models` from the adapter fallback/peek so the Settings card is not "0".
 */
export function enrichWorkBuddyStatusBody(
  body: unknown,
  roster: readonly unknown[],
): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const o = body as Record<string, unknown>;
  if (o.status !== "signed-in") return body;
  if (Array.isArray(o.models) && o.models.length > 0) return body;
  const models = statusModelsFromCatalog(roster);
  if (models.length === 0) return body;
  return { ...o, models };
}

function providerIdForWorkBuddyStatusPath(pathname: string): string | undefined {
  const p = pathname.replace(/\/+$/, "");
  if (p === "/plugins/dsh-workbuddy-connect/ai/status") return "workbuddy-ai";
  if (p === "/plugins/dsh-workbuddy-connect/status") return "workbuddy";
  return undefined;
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

  const session = createCommunityCordisHostSession({
    logPrefix: "dsh-workbuddy-connect",
    packageName,
    ...(wire.xrkHome ? { xrkHome: wire.xrkHome } : {}),
  });
  const { root, http, logger, disposers } = session;

  const bridge = createCommunityLoopbackLlmBridge({
    ...(wire.syncCommunityLlmProvider
      ? { syncCommunityLlmProvider: wire.syncCommunityLlmProvider }
      : {}),
    displayName: (providerId) =>
      providerId === "workbuddy-ai" ? "WorkBuddy AI" : "WorkBuddy",
    defaultApiKey: (providerId) => `xrk-workbuddy-${providerId}`,
    logPrefix: "dsh-workbuddy-connect",
    onBatchError: (error) => logger.warn("adapter sync batch failed", error),
  });
  const adaptersByProvider = bridge.adaptersByProvider;
  bridge.provideLlm(root);

  session.provideHostSurfaces();
  session.trackEffectsAndFibers();

  const ok = await session.applyEntry(
    path.join(pkgRoot, "lib", "index.js"),
    {},
    () => bridge.dispose(),
  );
  if (!ok) return undefined;

  session.sealHttp();

  // Identity/catalog hydrate is async inside WorkBuddy; first registerAdapter
  // sync often skips. Retries cover boot-with-saved-credentials without waiting
  // solely on llm/adapters-updated delivery.
  bridge.scheduler.scheduleRetries();
  disposers.push(() => {
    bridge.dispose();
  });

  // Until every variant has synced Face, status polls (post-login) re-nudge.
  // Also fill signed-in + empty `models` from catalog fallback (visibility gate).
  for (const row of http) {
    const inner = row.handle;
    row.handle = async (req, res, pathname) => {
      const method = (req.method ?? "GET").toUpperCase();
      const isStatusGet =
        method === "GET" && /\/status\/?$/i.test(pathname);
      if (!isStatusGet) {
        const handled = await inner(req, res, pathname);
        return handled;
      }

      let statusCode = 200;
      let headers: Record<string, unknown> = {};
      const chunks: Buffer[] = [];
      let ended = false;
      const proxy = {
        writeHead(
          code: number,
          reasonOrHeaders?: unknown,
          maybeHeaders?: unknown,
        ) {
          statusCode = code;
          if (
            reasonOrHeaders &&
            typeof reasonOrHeaders === "object" &&
            !Array.isArray(reasonOrHeaders)
          ) {
            headers = reasonOrHeaders as Record<string, unknown>;
          } else if (
            maybeHeaders &&
            typeof maybeHeaders === "object" &&
            !Array.isArray(maybeHeaders)
          ) {
            headers = maybeHeaders as Record<string, unknown>;
          }
          return proxy;
        },
        write(chunk: unknown) {
          if (chunk !== undefined && chunk !== null) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          }
          return true;
        },
        end(chunk?: unknown) {
          if (ended) return proxy;
          ended = true;
          if (chunk !== undefined && chunk !== null) {
            chunks.push(
              Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
            );
          }
          const raw = Buffer.concat(chunks);
          let out = raw;
          try {
            const parsed = JSON.parse(raw.toString("utf8")) as unknown;
            const providerId = providerIdForWorkBuddyStatusPath(pathname);
            const adapter =
              providerId !== undefined
                ? adaptersByProvider.get(providerId)
                : undefined;
            const catalog = adapter?.catalog;
            const roster =
              (catalog?.current?.()?.length ?? 0) > 0
                ? (catalog?.current?.() ?? [])
                : (catalog?.fallback?.() ?? []);
            const enriched = enrichWorkBuddyStatusBody(parsed, roster);
            if (enriched !== parsed) {
              out = Buffer.from(JSON.stringify(enriched), "utf8");
              headers = {
                ...headers,
                "content-type": "application/json; charset=utf-8",
                "content-length": String(out.byteLength),
              };
            }
          } catch {
            /* pass through */
          }
          res.writeHead(statusCode, headers as never);
          res.end(out);
          return proxy;
        },
      };

      const handled = await inner(req, proxy as never, pathname);
      if (handled && !bridge.scheduler.settled()) {
        void bridge.scheduler.runAll();
      }
      return handled;
    };
  }

  const { http: gatedHttp, rpc: gatedRpc } =
    await session.finishLive(packageName);

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
