/**
 * dsh-skin-market catalog + runtime state.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import {
  readXrkPluginInventory,
  type XrkPluginServicesOptions,
} from "../xrk/plugin-services.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { httpMethod, isMutatingMethod, parseJsonBody } from "./underlying/http-kit.js";
import {
  discoverInstalledSkins,
  isSkinPackageName,
  SKIN_NAME_HINTS,
} from "./skin-discover.js";

export { SKIN_NAME_HINTS, isSkinPackageName };

export interface SkinMarketOptions extends XrkPluginServicesOptions {
  readonly xrkHome?: string;
}

interface SkinMarketState {
  activeSkinId: string | null;
  skins: Array<{
    skinId: string;
    primary: boolean;
    activation: string;
  }>;
}

const EMPTY_STATE: SkinMarketState = {
  activeSkinId: null,
  skins: [],
};

const SKIN_MARKET_STORE = createXrkDocStore(
  ["skin-market", "state.json"],
  EMPTY_STATE,
);

function loadState(options: SkinMarketOptions): SkinMarketState {
  return SKIN_MARKET_STORE.read(options.xrkHome).data;
}

function buildCatalog(options: SkinMarketOptions): unknown[] {
  const discovered = discoverInstalledSkins(options);
  if (discovered.length > 0) {
    return discovered.map((skin) => ({
      id: skin.id,
      name: skin.name,
      version: skin.version,
      description: skin.tagline ?? `Installed skin (${skin.packageName})`,
      package: skin.packageName,
      source: "xrk-skin-json",
      ...(skin.accent ? { accent: skin.accent } : {}),
    }));
  }
  // Fallback: inventory name hints when no skin.json staged yet.
  const inv = readXrkPluginInventory(options);
  return inv.present.filter(isSkinPackageName).map((id) => ({
    id,
    name: id,
    version: inv.installedMap[id]?.version ?? "0.0.0",
    description: `Installed skin plugin (${id})`,
    source: "xrk-inventory",
  }));
}

function buildStatePayload(options: SkinMarketOptions): Record<string, unknown> {
  const inv = readXrkPluginInventory(options);
  const stored = loadState(options);
  const catalogIds = new Set(
    buildCatalog(options).map((s) => (s as { id: string }).id),
  );
  const skins = stored.skins.length
    ? stored.skins
    : stored.activeSkinId && catalogIds.has(stored.activeSkinId)
      ? [
          {
            skinId: stored.activeSkinId,
            primary: true,
            activation: "active",
          },
        ]
      : [];
  return {
    skins,
    installedClientPlugins: inv.present,
    runningAgentCount: 0,
    marketUpdateOperation: null,
    marketUpdateRestartRequired: false,
  };
}

export async function handleSkinMarketHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: SkinMarketOptions,
): Promise<boolean> {
  if (!pathname.startsWith("/dsh-skin-market")) return false;
  const method = httpMethod(req);
  const needsBody = isMutatingMethod(method);
  const body = needsBody ? await parseJsonBody(req) : {};

  if (pathname === "/dsh-skin-market/catalog" || pathname.endsWith("/catalog")) {
    sendJson(res, 200, { skins: buildCatalog(options) });
    return true;
  }

  if (pathname === "/dsh-skin-market/state" || pathname.endsWith("/state")) {
    sendJson(res, 200, buildStatePayload(options));
    return true;
  }

  if (
    (pathname.includes("/activate") || pathname.endsWith("/active")) &&
    needsBody
  ) {
    const skinId =
      typeof body.skinId === "string"
        ? body.skinId
        : typeof body.id === "string"
          ? body.id
          : null;
    const revision = setActiveSkin(options, skinId);
    sendJson(res, 200, { ok: true, activeSkinId: skinId, revision });
    return true;
  }

  if (pathname.includes("/restart")) {
    sendJson(res, 200, {
      ok: true,
      restarted: false,
      note: "XRK web shell reloads plugins via boot graph; no Cordis restart.",
    });
    return true;
  }

  if (
    pathname.includes("/operations") ||
    pathname.includes("/market-update")
  ) {
    sendJson(res, 200, { operations: [], phase: "done" });
    return true;
  }

  sendJson(res, 200, { path: pathname, adapter: "xrk-dsh-compat" });
  return true;
}

export function setActiveSkin(
  options: SkinMarketOptions,
  skinId: string | null,
): number {
  return SKIN_MARKET_STORE.write(options.xrkHome, {
    activeSkinId: skinId,
    skins: skinId
      ? [{ skinId, primary: true, activation: "active" }]
      : [],
  }).revision;
}
