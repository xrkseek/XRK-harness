/**
 * Deep-whale / generic skin manager Host routes:
 *   GET|POST `/api/dsh/skins`
 *   GET `/api/skin-manager/list` · POST `/api/skin-manager/apply`
 *
 * Discovers staged `skin.json` packs; persists active id under `~/.xrk`.
 * Exclusive Cordis patch rewriting is out of scope — switch stores preference
 * and returns ok so the client reload handoff succeeds.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import {
  httpMethod,
  isMutatingMethod,
  parseJsonBody,
} from "./underlying/http-kit.js";
import {
  discoverInstalledSkins,
  type SkinDiscoverOptions,
} from "./skin-discover.js";

export interface DshSkinsOptions extends SkinDiscoverOptions {
  readonly xrkHome?: string;
}

interface DshSkinsState {
  activeSkinId: string | null;
  desktopIconEnabled: boolean;
  /** Skin ids the user confirmed despite missing dshCompatibility. */
  acceptedRisk: string[];
}

const EMPTY_STATE: DshSkinsState = {
  activeSkinId: null,
  desktopIconEnabled: false,
  acceptedRisk: [],
};

const STORE = createXrkDocStore(["dsh-skins", "state.json"], EMPTY_STATE);

function loadState(options: DshSkinsStateOptions): DshSkinsState {
  const raw = STORE.read(options.xrkHome).data;
  return {
    activeSkinId:
      typeof raw.activeSkinId === "string" ? raw.activeSkinId : null,
    desktopIconEnabled: raw.desktopIconEnabled === true,
    acceptedRisk: Array.isArray(raw.acceptedRisk)
      ? raw.acceptedRisk.filter((id): id is string => typeof id === "string")
      : [],
  };
}

type DshSkinsStateOptions = Pick<DshSkinsOptions, "xrkHome">;

function saveState(
  options: DshSkinsStateOptions,
  state: DshSkinsState,
): number {
  return STORE.write(options.xrkHome, state).revision;
}

function managerCatalog(options: DshSkinsOptions) {
  const state = loadState(options);
  return discoverInstalledSkins(options).map((skin) => {
    const row: Record<string, unknown> = {
      id: skin.id,
      name: skin.name,
      package: skin.packageName,
      bodyAttr: skin.bodyAttr ?? `data-dsh-skin-${skin.id}`,
      wiringId: skin.wiringId ?? `ui-skin-${skin.id}`,
    };
    if (skin.nameEn) row.nameEn = skin.nameEn;
    if (skin.tagline) row.tagline = skin.tagline;
    if (skin.taglineEn) row.taglineEn = skin.taglineEn;
    if (skin.dshCompatibility) row.dshCompatibility = skin.dshCompatibility;
    if (skin.accent) row.accent = skin.accent;
    // XRK does not enforce DSH runtime semver gates — leave compatibility unset
    // unless the user previously accepted risk for a flagged skin.
    if (state.acceptedRisk.includes(skin.id)) {
      row.compatibility = {
        runtimeVersion: "xrk",
        exempted: true,
      };
    }
    return row;
  });
}

function localVersionRows(options: DshSkinsOptions) {
  return discoverInstalledSkins(options).map((skin) => ({
    id: skin.id,
    source: "build" as const,
    local: {
      hash: skin.version,
      short: skin.version.slice(0, 12),
    },
    remote: null,
    dirty: false,
    note: "XRK inventory version (no git probe)",
  }));
}

function isDshSkinsPath(pathname: string): boolean {
  return pathname === "/api/dsh/skins" || pathname.startsWith("/api/dsh/skins/");
}

function isSkinManagerPath(pathname: string): boolean {
  return (
    pathname === "/api/skin-manager" ||
    pathname.startsWith("/api/skin-manager/")
  );
}

export function isDshSkinsHttpPath(pathname: string): boolean {
  return isDshSkinsPath(pathname) || isSkinManagerPath(pathname);
}

async function handleDshSkinsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  options: DshSkinsOptions,
): Promise<void> {
  const method = httpMethod(req);
  const state = loadState(options);
  const catalog = managerCatalog(options);

  if (method === "GET" || method === "HEAD") {
    sendJson(res, 200, {
      ok: true,
      skins: catalog,
      desktopIcon: { enabled: state.desktopIconEnabled },
      activeSkinId: state.activeSkinId ?? "official",
    });
    return;
  }

  if (!isMutatingMethod(method)) {
    sendJson(res, 405, { ok: false, error: "method-not-allowed" });
    return;
  }

  const body = await parseJsonBody(req);
  const action = typeof body.action === "string" ? body.action : undefined;

  if (action === "local-versions") {
    sendJson(res, 200, { ok: true, versions: localVersionRows(options) });
    return;
  }

  if (action === "versions") {
    // Honest: no GitHub network probe from Host.
    sendJson(res, 200, {
      ok: true,
      versions: localVersionRows(options).map((row) => ({
        ...row,
        remote: null,
        note: "Remote version compare is not available on XRK Host",
      })),
    });
    return;
  }

  if (action === "desktop-icon") {
    if (typeof body.enabled !== "boolean") {
      sendJson(res, 400, { ok: false, error: "invalid-desktop-icon-request" });
      return;
    }
    const next = { ...state, desktopIconEnabled: body.enabled };
    saveState(options, next);
    sendJson(res, 200, {
      ok: true,
      desktopIcon: {
        enabled: body.enabled,
        updated: 0,
        failed: 0,
        note: "Desktop shortcut icon sync requires the Desktop Host shell; preference stored only.",
      },
    });
    return;
  }

  // Default POST body: { target, acceptRisk? } — switch active skin.
  const target = typeof body.target === "string" ? body.target : undefined;
  if (!target) {
    sendJson(res, 400, { ok: false, error: "invalid-skin-target" });
    return;
  }
  if (target !== "official" && !catalog.some((skin) => skin.id === target)) {
    sendJson(res, 400, { ok: false, error: "invalid-skin-target" });
    return;
  }

  const acceptedRisk = [...state.acceptedRisk];
  if (body.acceptRisk === true && target !== "official") {
    if (!acceptedRisk.includes(target)) acceptedRisk.push(target);
  }

  saveState(options, {
    ...state,
    activeSkinId: target === "official" ? null : target,
    acceptedRisk,
  });
  sendJson(res, 200, {
    ok: true,
    activeSkinId: target,
    note: "Preference stored; reload applies client skins already in boot graph.",
  });
}

async function handleSkinManagerAlias(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: DshSkinsOptions,
): Promise<void> {
  const method = httpMethod(req);
  const state = loadState(options);
  const skins = discoverInstalledSkins(options).map((skin) => ({
    id: skin.id,
    name: skin.name,
    package: skin.packageName,
    ...(skin.accent ? { accent: skin.accent } : {}),
    ...(skin.tagline ? { tagline: skin.tagline } : {}),
  }));

  if (
    (pathname === "/api/skin-manager/list" || pathname === "/api/skin-manager") &&
    (method === "GET" || method === "HEAD")
  ) {
    sendJson(res, 200, {
      skins,
      active: state.activeSkinId,
    });
    return;
  }

  if (pathname === "/api/skin-manager/apply" && isMutatingMethod(method)) {
    const body = await parseJsonBody(req);
    const id = typeof body.id === "string" ? body.id : null;
    if (id !== null && id !== "official" && !skins.some((s) => s.id === id)) {
      sendJson(res, 404, { ok: false, error: "skin-not-found" });
      return;
    }
    saveState(options, {
      ...state,
      activeSkinId: id === "official" || id === null ? null : id,
    });
    sendJson(res, 200, {
      ok: true,
      active: id === "official" ? null : id,
    });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    path: pathname,
    adapter: "xrk-dsh-compat",
  });
}

export async function handleDshSkinsHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: DshSkinsOptions = {},
): Promise<boolean> {
  if (isDshSkinsPath(pathname)) {
    await handleDshSkinsRoute(req, res, options);
    return true;
  }
  if (isSkinManagerPath(pathname)) {
    await handleSkinManagerAlias(req, res, pathname, options);
    return true;
  }
  return false;
}
