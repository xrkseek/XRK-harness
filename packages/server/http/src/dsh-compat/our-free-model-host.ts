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
import { createCommunityCordisHostSession } from "./community-cordis-host-session.js";
import {
  communityLoopbackEndpointFromBits,
  communityLoopbackEndpointFromSummaryHttp,
  createCommunityLoopbackLlmBridge,
  type CommunityLoopbackEndpoint,
} from "./community-loopback-llm-bridge.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { ensureHostModuleRemap } from "./host-module-remap.js";
import { isPluginPackageFamily } from "./plugin-package-id.js";

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
 * OFM listModels has no baseUrl; Face sync uses the OpenAI forward listener.
 * Disk `forward.port` is the *requested* bind (often 0 = ephemeral); the OS
 * port lives in live `/summary` as `forward.actualPort`.
 */
function forwardEndpointFromHome(dshHome: string): CommunityLoopbackEndpoint {
  const file = path.join(dshHome, OFM_DATA_DIR, "settings.json");
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      forward?: { port?: unknown; host?: unknown; enabled?: unknown };
      forwardKey?: unknown;
    };
    return communityLoopbackEndpointFromBits({
      host: raw.forward?.host,
      port: raw.forward?.port,
      apiKey: raw.forwardKey,
    });
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
  const bridge = createCommunityLoopbackLlmBridge({
    ...(wire.syncCommunityLlmProvider
      ? { syncCommunityLlmProvider: wire.syncCommunityLlmProvider }
      : {}),
    displayName: (id) => DISPLAY_NAMES[id] ?? id,
    defaultApiKey: (id) => `xrk-${id}`,
    logPrefix: OFM_PACKAGE,
    onBatchError: (error) => logger.warn("adapter sync batch failed", error),
    async resolveEndpoint(): Promise<CommunityLoopbackEndpoint> {
      const fromDisk = forwardEndpointFromHome(dshHome);
      const fromLive =
        fromDisk.baseUrl || lastForward.baseUrl
          ? {}
          : await communityLoopbackEndpointFromSummaryHttp(
              http,
              `${OFM_API_PREFIX}/summary`,
            );
      const baseUrl =
        fromDisk.baseUrl ?? fromLive.baseUrl ?? lastForward.baseUrl;
      const apiKey =
        fromDisk.apiKey ?? fromLive.apiKey ?? lastForward.apiKey;
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
  disposers.push(() => {
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
