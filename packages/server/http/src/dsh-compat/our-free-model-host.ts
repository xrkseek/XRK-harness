/**
 * Load staged `dsh-our-free-model` Cordis host half and bridge
 * `llm.registerAdapter` → Face `llm-pi-ai` via the plugin's OpenAI forward listener.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  DshAdapterContribution,
  DshCompatWireOptions,
} from "./adapter-types.js";
import { createCordisAttachmentsBridge } from "./cordis-attachments-bridge.js";
import { communityCredentialsStorePath } from "./cordis-credentials-bridge.js";
import { createCommunityCordisHostSession } from "./community-cordis-host-session.js";
import {
  communityLoopbackEndpointFromForwardSettings,
  communityLoopbackEndpointFromSummaryHttp,
  createCommunityLoopbackLlmBridge,
  readCommunityJsonViaHttp,
  type CommunityLoopbackEndpoint,
} from "./community-loopback-llm-bridge.js";
import { isUsableCommunityLoopbackBaseUrl } from "./community-llm-host-sync.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { ensureHostModuleRemap } from "./host-module-remap.js";
import { isPluginPackageFamily } from "./plugin-package-id.js";

const OFM_PACKAGE = "dsh-our-free-model";
const OFM_DATA_DIR = "our-free-model";
const OFM_API_PREFIX = "/api/our-free-model";
/** Channel-pack management RPC + captcha carrier (vendored pack registers here). */
const OFM_CHANNEL_PACK_PREFIX = "/api/channel-pack";

/** OFM FreeModelAdapter routes only — see dsh-our-free-model `ROUTE_MAIN` / `ROUTE_REGION`. */
const OFM_FACE_PROVIDER_IDS = new Set([
  "our-free-model",
  "our-free-model-region",
]);

const DISPLAY_NAMES: Record<string, string> = {
  "our-free-model": "Our Free Model",
  "our-free-model-region": "Our Free Model · region-limited",
};

/** True for the two free-lane picker routes (not channel-pack product ids). */
export function isOurFreeModelFaceProvider(providerId: string): boolean {
  return OFM_FACE_PROVIDER_IDS.has(providerId.trim());
}

/** One channel-pack account row (only the fields the Face gate needs). */
type ChannelPackAccountRow = {
  readonly provider?: unknown;
  readonly enabled?: unknown;
  readonly credentialRef?: unknown;
};

function readJsonObject(file: string): Record<string, unknown> | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * channel-pack providers worth Face-syncing: an **enabled** account whose
 * credential actually resolves on disk.
 *
 * v0.7.3 dropped every channel-pack id from Face because each sync costs one
 * `listModels` per provider and eight empty lanes stalled status polling. Reading
 * the login state (not the adapter) keeps that budget: an empty lane never joins
 * the loop, and a provider appears the moment the user logs in.
 */
export function ofmChannelPackFaceProviders(options: {
  readonly xrkHome: string;
  readonly packageName: string;
}): Set<string> {
  const ready = new Set<string>();
  const state = readJsonObject(
    path.join(options.xrkHome, "channel-pack", "state.json"),
  );
  const rows = Array.isArray(state?.accounts)
    ? (state.accounts as ChannelPackAccountRow[])
    : [];
  if (rows.length === 0) return ready;
  const store =
    readJsonObject(
      communityCredentialsStorePath(options.xrkHome, options.packageName),
    ) ?? {};
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (row.enabled !== true) continue;
    const provider =
      typeof row.provider === "string" ? row.provider.trim() : "";
    const ref =
      typeof row.credentialRef === "string" ? row.credentialRef.trim() : "";
    if (!provider || !ref) continue;
    const value = store[ref];
    if (typeof value !== "string" || value.length === 0) continue;
    ready.add(provider);
  }
  return ready;
}

/**
 * Face sync gate: free-lane routes always; channel-pack ids only while they have
 * a resolvable credential. Re-read at most once per second so login / logout
 * lands without a Host restart, and a poll storm never re-reads the disk.
 */
export function ofmFaceSyncGate(options: {
  readonly xrkHome: string;
  readonly packageName: string;
  readonly now?: () => number;
  readonly ttlMs?: number;
}): (providerId: string) => boolean {
  const ttlMs = options.ttlMs ?? 1_000;
  const now = options.now ?? Date.now;
  let readAt = Number.NEGATIVE_INFINITY;
  let channelIds = new Set<string>();
  return (providerId: string) => {
    const id = providerId.trim();
    if (isOurFreeModelFaceProvider(id)) return true;
    const at = now();
    if (at - readAt >= ttlMs) {
      channelIds = ofmChannelPackFaceProviders(options);
      readAt = at;
    }
    return channelIds.has(id);
  };
}

export function isOurFreeModelPackage(packageName: string): boolean {
  return isPluginPackageFamily(packageName, OFM_PACKAGE);
}

/**
 * OFM sealed-lane gate (`detectSealedHost`): `web` and `web-desktop` are the
 * same flavor. Desktop Host sets `XRK_SURFACE=desktop` on the child.
 */
export function ofmProfileName(
  env: NodeJS.ProcessEnv = process.env,
): "web" | "web-desktop" {
  return env.XRK_SURFACE === "desktop" ? "web-desktop" : "web";
}

export function hasOurFreeModelEntry(pkgRoot: string): boolean {
  return existsSync(path.join(pkgRoot, "index.js"));
}

/**
 * Ids the forward listener routes right now.
 *
 * `/summary.models` is the plugin's own `publicModelRows()`, i.e. the exact
 * membership `createForwardCompletion` consults before it runs a model. Face
 * must publish no more than that: `adapter.listModels` reads membership too, but
 * the two readings can drift across a catalog rebuild (login, aggregate edit,
 * probe round), and a picker row forward stopped accepting answers
 * `openai-compatible HTTP 404: model "…" not found` — the request never leaves
 * the machine.
 *
 * `undefined` means "no usable reading" (forward down, summary empty) so callers
 * keep the unfiltered list rather than clearing the picker on a bad snapshot.
 */
export async function ofmRoutableModelIds(
  http: Parameters<typeof communityLoopbackEndpointFromSummaryHttp>[0],
): Promise<ReadonlySet<string> | undefined> {
  const payload = await readCommunityJsonViaHttp(
    http,
    `${OFM_API_PREFIX}/summary`,
  );
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const models = (payload as { models?: unknown }).models;
  if (!Array.isArray(models)) return undefined;
  const ids = new Set<string>();
  for (const row of models) {
    if (typeof row === "string" && row.trim()) ids.add(row.trim());
  }
  return ids.size > 0 ? ids : undefined;
}

/**
 * OFM listModels has no baseUrl; Face sync uses the OpenAI forward listener.
 * Disk `forward.port` is the *requested* bind (often 0 = ephemeral); the OS
 * port lives in live `/summary` as `forward.actualPort`.
 */
function forwardEndpointFromHome(dshHome: string): CommunityLoopbackEndpoint {
  const file = path.join(dshHome, OFM_DATA_DIR, "settings.json");
  if (!existsSync(file)) return {};
  try {
    // Prefer actualPort over requested port:0 (same rules as live /summary).
    return communityLoopbackEndpointFromForwardSettings(
      JSON.parse(readFileSync(file, "utf8")) as unknown,
    );
  } catch {
    return {};
  }
}

/**
 * Poll OFM `/summary` until forward is listening (boot: syncForward after
 * registerAdapter). Calls `onReady` once, or `onTimeout` after attempts.
 */
export async function waitForOfmForwardThenSync(options: {
  readonly http: Parameters<typeof communityLoopbackEndpointFromSummaryHttp>[0];
  readonly isDisposed?: () => boolean;
  readonly onReady: (endpoint: CommunityLoopbackEndpoint) => void;
  readonly onTimeout?: () => void;
  /** Default: 40 × 250ms ≈ 10s (covers catalog+bind on slow Termux). */
  readonly attempts?: number;
  readonly intervalMs?: number;
}): Promise<void> {
  const attempts = options.attempts ?? 40;
  const intervalMs = options.intervalMs ?? 250;
  for (let i = 0; i < attempts; i++) {
    if (options.isDisposed?.()) return;
    const endpoint = await communityLoopbackEndpointFromSummaryHttp(
      options.http,
      `${OFM_API_PREFIX}/summary`,
    );
    if (
      endpoint.baseUrl &&
      isUsableCommunityLoopbackBaseUrl(endpoint.baseUrl) &&
      endpoint.apiKey
    ) {
      options.onReady(endpoint);
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      timer.unref?.();
    });
  }
  if (!options.isDisposed?.()) options.onTimeout?.();
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
        // Host-staged: stand down self-updater / hot-reload into pluginsDir.
        distribution: "managed",
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

  const session = createCommunityCordisHostSession({
    logPrefix: OFM_PACKAGE,
    packageName,
    ...(wire.xrkHome ? { xrkHome: wire.xrkHome } : {}),
  });
  const { root, http, logger, dshHome, disposers } = session;
  process.env.DSH_HOME = dshHome;
  ensureForwardSeed(dshHome);

  /** Survives brief settings.json rewrites while forward rebinds (port:0 window). */
  let lastForward: CommunityLoopbackEndpoint = {};
  let hostDisposed = false;
  /**
   * Last routable roster from `/summary`, cached across one sync flush burst.
   * The read is in-process, but a flush walks every published provider.
   */
  let routableIdsAt = Number.NEGATIVE_INFINITY;
  let routableIds: ReadonlySet<string> | undefined;
  const readRoutableIds = async (): Promise<ReadonlySet<string> | undefined> => {
    const at = Date.now();
    if (at - routableIdsAt < 2_000) return routableIds;
    routableIds = await ofmRoutableModelIds(http);
    routableIdsAt = at;
    return routableIds;
  };
  const syncProvider = wire.syncCommunityLlmProvider;
  const bridge = createCommunityLoopbackLlmBridge({
    ...(syncProvider
      ? {
          syncCommunityLlmProvider: async (args) => {
            const routable = await readRoutableIds();
            if (routable === undefined) {
              await syncProvider(args);
              return;
            }
            // Publish exactly what forward will route: a row it refuses turns
            // into HTTP 404 the moment the user picks it from the picker.
            await syncProvider({
              ...args,
              models: args.models.filter((model) =>
                routable.has(model.id.trim()),
              ),
            });
          },
        }
      : {}),
    displayName: (id) => DISPLAY_NAMES[id] ?? id,
    // No defaultApiKey: wait for OFM forwardKey after syncForward (not xrk-*).
    logPrefix: OFM_PACKAGE,
    // Channel-pack adapters share this Cordis llm. Free-lane routes always sync;
    // a channel-pack id joins only while it has a logged-in credential.
    shouldSyncProvider: ofmFaceSyncGate({
      xrkHome: dshHome,
      packageName,
    }),
    onBatchError: (error) => logger.warn("adapter sync batch failed", error),
    async resolveEndpoint(): Promise<CommunityLoopbackEndpoint> {
      const fromDisk = forwardEndpointFromHome(dshHome);
      // Always prefer live `/summary.actualPort` when disk still has port:0 —
      // boot binds forward after first registerAdapter sync (OFM index.js).
      const fromLive = fromDisk.baseUrl
        ? {}
        : await communityLoopbackEndpointFromSummaryHttp(
            http,
            `${OFM_API_PREFIX}/summary`,
          );
      const baseUrl =
        fromLive.baseUrl ?? fromDisk.baseUrl ?? lastForward.baseUrl;
      const apiKey =
        fromLive.apiKey ?? fromDisk.apiKey ?? lastForward.apiKey;
      if (baseUrl) {
        lastForward = {
          baseUrl,
          ...(apiKey
            ? { apiKey }
            : lastForward.apiKey
              ? { apiKey: lastForward.apiKey }
              : {}),
        };
      }
      const resolvedKey = apiKey ?? lastForward.apiKey;
      return {
        ...(baseUrl ? { baseUrl } : {}),
        ...(resolvedKey ? { apiKey: resolvedKey } : {}),
      };
    },
  });
  bridge.provideLlm(root);

  session.provideHostSurfaces({
    settingsConfigure: true,
    profileContext: { name: ofmProfileName(), home: dshHome },
    attachments: createCordisAttachmentsBridge(dshHome),
    commands: true,
  });
  session.trackEffectsAndFibers();

  const ok = await session.applyEntry(
    path.join(pkgRoot, "index.js"),
    { distribution: "managed" },
    () => bridge.dispose(),
  );
  if (!ok) return undefined;

  // Seal before return so async pack.apply → connection.fetch.register late-binds.
  session.sealHttp();
  bridge.scheduler.scheduleRetries();
  // OFM boot: registerAdapter fires before syncForward — poll until forward is up.
  void waitForOfmForwardThenSync({
    http,
    isDisposed: () => hostDisposed,
    onReady: (endpoint) => {
      lastForward = {
        ...(endpoint.baseUrl ? { baseUrl: endpoint.baseUrl } : lastForward),
        ...(endpoint.apiKey
          ? { apiKey: endpoint.apiKey }
          : lastForward.apiKey
            ? { apiKey: lastForward.apiKey }
            : {}),
      };
      bridge.requestSync(true);
    },
    onTimeout: () => {
      logger.warn(
        "forward listener not ready after boot poll; Face sync keeps retrying",
      );
      bridge.requestSync(true);
    },
  });
  disposers.push(() => {
    hostDisposed = true;
    bridge.dispose();
  });

  // Until main + region providers have synced Face, status GETs re-nudge.
  bridge.nudgeHttpOnGet(http, { prefixes: [OFM_API_PREFIX] });

  const { http: gatedHttp, rpc: gatedRpc } =
    await session.finishLive(packageName);

  const httpPrefixes = [OFM_API_PREFIX];
  if (gatedHttp.some((row) => row.match(OFM_CHANNEL_PACK_PREFIX))) {
    httpPrefixes.push(OFM_CHANNEL_PACK_PREFIX);
  }

  return {
    meta: {
      id: "dsh-our-free-model-host",
      package: packageName,
      httpPrefixes,
      rpcChannels: Object.keys(gatedRpc),
      description: `${DSH_COMPAT_ADAPTER}: Our Free Model Cordis host half`,
    },
    ...(gatedHttp.length ? { http: gatedHttp } : {}),
    ...(Object.keys(gatedRpc).length ? { rpc: gatedRpc } : {}),
  };
}
