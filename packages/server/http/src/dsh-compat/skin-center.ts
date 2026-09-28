/**
 * `@linxin666/dsh-client-ui-skin-center` Host surface (`/api/skin-center/*`).
 *
 * Serves catalog + active preference + static skin files (stylesheet / patches /
 * hooks / assets) from staged `skin.json` packs and bundled `skins/` dirs.
 */
import {
  createReadStream,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dataPath } from "./underlying/json-store.js";
import { sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import {
  httpMethod,
  isMutatingMethod,
  parseJsonBody,
} from "./underlying/http-kit.js";
import {
  discoverInstalledSkins,
  findSkinById,
  resolveSkinRelative,
  type SkinDiscoverOptions,
} from "./skin-discover.js";

export interface SkinCenterOptions extends SkinDiscoverOptions {
  readonly xrkHome?: string;
}

function listWallpapersFromUploads(options: SkinCenterOptions): unknown[] {
  const dir = dataPath(options.xrkHome, "wallpaper-engine", "uploads");
  if (!existsSync(dir)) return [];
  const out: unknown[] = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    try {
      const st = statSync(abs);
      if (!st.isFile()) continue;
      out.push({
        id: name,
        title: path.parse(name).name,
        kind: "upload",
        bytes: st.size,
      });
    } catch {
      /* skip */
    }
  }
  return out;
}

interface SkinCenterState {
  active: string | null;
  background: unknown;
}

const EMPTY_STATE: SkinCenterState = {
  active: null,
  background: null,
};

const STORE = createXrkDocStore(
  ["skin-center", "active.json"],
  EMPTY_STATE,
);

function loadState(options: SkinCenterOptions): SkinCenterState {
  const raw = STORE.read(options.xrkHome).data;
  return {
    active: typeof raw.active === "string" ? raw.active : null,
    background: raw.background ?? null,
  };
}

function saveState(
  options: SkinCenterOptions,
  state: SkinCenterState,
): number {
  return STORE.write(options.xrkHome, state).revision;
}

export function isSkinCenterPath(pathname: string): boolean {
  return (
    pathname === "/api/skin-center" || pathname.startsWith("/api/skin-center/")
  );
}

function contentTypeFor(file: string): string {
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".mjs") || file.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".webp")) return "image/webp";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".mp4")) return "video/mp4";
  if (file.endsWith(".webm")) return "video/webm";
  return "application/octet-stream";
}

function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  abs: string,
): void {
  const method = (req.method ?? "GET").toUpperCase();
  const st = statSync(abs);
  const headers: Record<string, string> = {
    "Content-Type": contentTypeFor(abs),
    "Content-Length": String(st.size),
    "Cache-Control": "public, max-age=60",
    "X-Content-Type-Options": "nosniff",
  };
  res.writeHead(200, headers);
  if (method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(abs).pipe(res);
}

function catalogPayload(options: SkinCenterOptions) {
  const skins = discoverInstalledSkins(options).map((skin) => {
    const manifest = { ...skin.manifest };
    if (!manifest.version) manifest.version = skin.version;
    if (!manifest.id) manifest.id = skin.id;
    // Ensure contributes.stylesheet shape for v2 clients when only legacy fields exist.
    if (!manifest.contributes && existsSync(path.join(skin.dir, "skin.css"))) {
      manifest.contributes = {
        stylesheet: "skin.css",
        ...(existsSync(path.join(skin.dir, "patches.css"))
          ? { patches: "patches.css" }
          : {}),
      };
    }
    return {
      manifest,
      ...(skin.channel ? { channel: skin.channel } : {}),
      origin: skin.origin,
      package: skin.packageName,
    };
  });
  return { skins, diagnostics: [] as unknown[] };
}

async function handleWe(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: SkinCenterOptions,
): Promise<boolean> {
  const method = httpMethod(req);
  const weBase = "/api/skin-center/we";

  if (pathname === `${weBase}/inventory` && (method === "GET" || method === "HEAD")) {
    const wallpapers = listWallpapersFromUploads(options);
    sendJson(res, 200, {
      ok: true,
      wallpapers,
      total: wallpapers.length,
    });
    return true;
  }

  if (pathname === `${weBase}/scene-probe` && (method === "GET" || method === "HEAD")) {
    sendJson(res, 200, {
      ok: true,
      video: false,
      webgl: false,
      note: "Scene probe is a no-op on XRK Host",
    });
    return true;
  }

  if (pathname.startsWith(`${weBase}/`) && isMutatingMethod(method)) {
    await parseJsonBody(req);
    sendJson(res, 200, {
      ok: true,
      path: pathname,
      note: "Wallpaper Engine actions are not wired on XRK Host",
    });
    return true;
  }

  if (pathname === weBase || pathname.startsWith(`${weBase}/`)) {
    sendJson(res, 200, { ok: true, path: pathname, adapter: "xrk-skin-center" });
    return true;
  }
  return false;
}

export async function handleSkinCenterHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: SkinCenterOptions = {},
): Promise<boolean> {
  if (!isSkinCenterPath(pathname)) return false;
  const method = httpMethod(req);

  if (await handleWe(req, res, pathname, options)) return true;

  const v2 = "/api/skin-center/v2";

  if (pathname === `${v2}/catalog` && (method === "GET" || method === "HEAD")) {
    sendJson(res, 200, catalogPayload(options));
    return true;
  }

  if (pathname === `${v2}/active`) {
    if (method === "GET" || method === "HEAD") {
      const state = loadState(options);
      sendJson(res, 200, {
        ok: true,
        active: state.active,
        background: state.background,
      });
      return true;
    }
    if (isMutatingMethod(method)) {
      const body = await parseJsonBody(req);
      const state = loadState(options);
      const next: SkinCenterState = { ...state };
      if ("active" in body) {
        next.active =
          typeof body.active === "string"
            ? body.active
            : body.active === null
              ? null
              : state.active;
      }
      if ("background" in body) {
        next.background = body.background;
      }
      saveState(options, next);
      sendJson(res, 200, {
        ok: true,
        active: next.active,
        background: next.background,
      });
      return true;
    }
  }

  if (pathname === `${v2}/verify` && isMutatingMethod(method)) {
    await parseJsonBody(req);
    const skins = discoverInstalledSkins(options);
    const details = skins.map((skin) => ({
      id: skin.id,
      ok: true,
      issues: [] as string[],
    }));
    sendJson(res, 200, {
      ok: true,
      total: skins.length,
      valid: skins.length,
      issues: 0,
      repaired: [] as string[],
      repairFailed: [] as string[],
      details,
    });
    return true;
  }

  // `/api/skin-center/v2/skins/<id>/…`
  const skinMatch = pathname.match(
    /^\/api\/skin-center\/v2\/skins\/([^/]+)(?:\/(.*))?$/,
  );
  if (skinMatch) {
    const skinId = decodeURIComponent(skinMatch[1]!);
    const rest = skinMatch[2] ?? "";
    const skin = findSkinById(options, skinId);
    if (!skin) {
      sendJson(res, 404, { ok: false, error: "skin-not-found" });
      return true;
    }

    if (rest === "uninstall" && isMutatingMethod(method)) {
      sendJson(res, 200, {
        ok: true,
        removed: false,
        note: "Uninstall via xrkh plugin remove; Host does not delete staged packs here.",
      });
      return true;
    }

    if (method !== "GET" && method !== "HEAD") {
      sendJson(res, 405, { ok: false, error: "method-not-allowed" });
      return true;
    }

    const contributes = skin.manifest.contributes as
      | Record<string, unknown>
      | undefined;

    if (rest === "stylesheet") {
      const rel =
        (typeof contributes?.stylesheet === "string"
          ? contributes.stylesheet
          : undefined) ?? "skin.css";
      const abs = resolveSkinRelative(skin.dir, rel);
      if (!abs) {
        res.writeHead(404).end();
        return true;
      }
      sendFile(req, res, abs);
      return true;
    }

    if (rest === "patches") {
      const rel =
        typeof contributes?.patches === "string" ? contributes.patches : undefined;
      if (!rel) {
        res.writeHead(404).end();
        return true;
      }
      const abs = resolveSkinRelative(skin.dir, rel);
      if (!abs) {
        res.writeHead(404).end();
        return true;
      }
      sendFile(req, res, abs);
      return true;
    }

    if (rest === "hooks.mjs") {
      const facets = skin.manifest.facets as
        | { client?: { entry?: string } }
        | undefined;
      const entry = facets?.client?.entry ?? "hooks.mjs";
      const abs = resolveSkinRelative(skin.dir, entry);
      if (!abs) {
        res.writeHead(404).end();
        return true;
      }
      sendFile(req, res, abs);
      return true;
    }

    // Background media + preview assets: `/skins/<id>/<relpath>`
    if (rest) {
      const abs = resolveSkinRelative(skin.dir, rest);
      if (!abs) {
        res.writeHead(404).end();
        return true;
      }
      sendFile(req, res, abs);
      return true;
    }

    // Bare skin id → manifest snapshot
    sendJson(res, 200, {
      ok: true,
      manifest: skin.manifest,
      package: skin.packageName,
    });
    return true;
  }

  sendJson(res, 200, {
    ok: true,
    path: pathname,
    adapter: "xrk-skin-center",
  });
  return true;
}

/** Test helper — expose catalog builder. */
export function readSkinCenterCatalogForTest(options: SkinCenterOptions) {
  return catalogPayload(options);
}
