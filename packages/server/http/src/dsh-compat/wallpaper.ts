/**
 * Host bridge for `dsh-plugin-wallpaper-engine` (ROUTE-INDEX shapes).
 *
 * Grades (see docs/community-plugin-compat.md):
 *   full     — custom upload + settings persistence
 *   degraded — picker-shaped inventory / idle media / empty fonts
 *   stub     — 1×1 PNG so <img>/video tags settle
 *   refuse   — honest JSON note (no silent fake success)
 *
 * Does **not** run the plugin's Cordis `lib/index.js` apply (Steam scan ·
 * WebWallGL · ffmpeg · subpackages). Those stay future Cordis-host milestones.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { readBody, sendJson } from "./underlying/http-json.js";
import { dataPath } from "./underlying/json-store.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { parseJsonBody } from "./underlying/http-kit.js";

export interface WallpaperOptions {
  readonly xrkHome?: string;
}

const BASE = "/wallpaper-engine";

/** 1×1 PNG — keeps <img src="/scene-frame/…"> from breaking. */
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const DEFAULT_SETTINGS: Record<string, unknown> = {
  scrim: 0.25,
  border: 0.35,
  blur: 16,
  wallpaperBlur: 0,
  rotationEnabled: false,
  rotationInterval: 30,
  rotationGroupId: "",
  rotationGroups: [],
  rotationSeeded: false,
  hiddenIds: [],
  playbackRate: 1,
  flip: false,
  objectFit: "cover",
  contentRatingFilter: "everyone",
  wallpaperTypeFilter: "all",
  activeId: null,
  activeKind: null,
};

/** Namespaces the upstream settings router accepts under `/settings/<ns>`. */
const SETTINGS_NAMESPACES = new Set([
  "core",
  "glass",
  "fonts",
  "mascot",
  "media",
  "rotation",
  "picker",
  "advanced",
]);

interface WallpaperSettingsDoc {
  settings: Record<string, unknown>;
}

const EMPTY_SETTINGS_DOC: WallpaperSettingsDoc = {
  settings: { ...DEFAULT_SETTINGS },
};

const WALLPAPER_SETTINGS_STORE = createXrkDocStore(
  ["wallpaper-engine", "config.json"],
  EMPTY_SETTINGS_DOC,
);

function rootDir(options: WallpaperOptions): string {
  return dataPath(options.xrkHome, "wallpaper-engine");
}

function uploadDir(options: WallpaperOptions): string {
  const dir = path.join(rootDir(options), "uploads");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function cacheDir(options: WallpaperOptions): string {
  const dir = path.join(rootDir(options), "cache");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function loadSettings(options: WallpaperOptions): Record<string, unknown> {
  const stored = WALLPAPER_SETTINGS_STORE.read(options.xrkHome).data.settings;
  return {
    ...DEFAULT_SETTINGS,
    ...(stored && typeof stored === "object" ? stored : {}),
  };
}

function saveSettings(
  options: WallpaperOptions,
  settings: Record<string, unknown>,
): number {
  return WALLPAPER_SETTINGS_STORE.write(options.xrkHome, { settings }).revision;
}

function uploadType(name: string): "image" | "video" | "web" {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".mp4" || ext === ".webm") return "video";
  if (ext === ".html" || ext === ".htm") return "web";
  return "image";
}

function mediaExt(name: string): string {
  return path.extname(name).replace(/^\./, "").toLowerCase() || "bin";
}

/**
 * Picker-compatible inventory rows (src/picker-model.js): need `type` +
 * `playable` + `media` / `preview` URL shapes even when Steam scan is absent.
 */
function listWallpapers(options: WallpaperOptions): Record<string, unknown>[] {
  const dir = uploadDir(options);
  const out: Record<string, unknown>[] = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    try {
      const st = statSync(abs);
      if (!st.isFile()) continue;
      const type = uploadType(name);
      const playable = type === "video" || type === "web" || type === "image";
      out.push({
        id: name,
        title: path.parse(name).name,
        type,
        kind: "upload",
        playable,
        contentrating: "Everyone",
        media: `${BASE}/media/${encodeURIComponent(name)}`,
        mediaExt: mediaExt(name),
        preview:
          type === "image"
            ? `${BASE}/preview/${encodeURIComponent(name)}`
            : null,
        path: abs,
        bytes: st.size,
        propsUrl: null,
        sceneLiveSrc: null,
        sceneVideo: null,
        sceneAudio: null,
        frameUrl: null,
        liveFrame: null,
      });
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

function uploadIdFor(bytes: Buffer, ext: string): string {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  return `up-${hash}${ext}`;
}

function sendPlaceholderPng(res: ServerResponse, method: string): void {
  res.writeHead(200, {
    "content-type": "image/png",
    "content-length": String(PLACEHOLDER_PNG.length),
    "cache-control": "no-store",
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(PLACEHOLDER_PNG);
}

function sendFileBytes(
  res: ServerResponse,
  method: string,
  abs: string,
  contentType: string,
): void {
  const buf = readFileSync(abs);
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": String(buf.length),
    "cache-control": "no-store",
    "accept-ranges": "bytes",
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(buf);
}

function contentTypeFor(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".html" || ext === ".htm") return "text/html; charset=utf-8";
  return "application/octet-stream";
}

function stripQuery(pathname: string): string {
  const q = pathname.indexOf("?");
  return q >= 0 ? pathname.slice(0, q) : pathname;
}

function tokenTail(pathname: string, prefix: string): string {
  return decodeURIComponent(stripQuery(pathname.slice(prefix.length)));
}

function refuse(
  res: ServerResponse,
  note: string,
  extra: Record<string, unknown> = {},
): void {
  sendJson(res, 200, { ok: false, note, bridge: "xrk-wallpaper", ...extra });
}

function idleNowPlaying(): Record<string, unknown> {
  return {
    ok: true,
    playing: false,
    title: null,
    artist: null,
    album: null,
    app: null,
    note: "System Now Playing is not bridged on XRK Host (media-bridge subpackage not applied).",
  };
}

export function isWallpaperHttpPath(pathname: string): boolean {
  return (
    pathname.startsWith(BASE) ||
    pathname === "/scene-anim" ||
    pathname.startsWith("/scene-anim/") ||
    pathname === "/scene-frame" ||
    pathname.startsWith("/scene-frame/") ||
    pathname === "/api/local-assets" ||
    pathname.startsWith("/api/local-assets/")
  );
}

export async function handleWallpaperHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: WallpaperOptions,
): Promise<boolean> {
  if (!isWallpaperHttpPath(pathname)) return false;
  const method = (req.method ?? "GET").toUpperCase();
  const p = stripQuery(pathname);

  // ── Scene stubs (root + BASE) ───────────────────────────────────────────
  if (
    p === "/scene-frame" ||
    p.startsWith("/scene-frame/") ||
    p === `${BASE}/scene-frame` ||
    p.startsWith(`${BASE}/scene-frame/`) ||
    p === "/scene-anim" ||
    p.startsWith("/scene-anim/") ||
    p === `${BASE}/scene-anim` ||
    p.startsWith(`${BASE}/scene-anim/`) ||
    p.startsWith(`${BASE}/scene-frame-cache/`) ||
    p.startsWith(`${BASE}/custom-frame`) ||
    p.startsWith(`${BASE}/live-frame`)
  ) {
    sendPlaceholderPng(res, method);
    return true;
  }

  if (p.startsWith(`${BASE}/scene-anim-progress/`)) {
    const token = tokenTail(p, `${BASE}/scene-anim-progress/`);
    sendJson(res, 200, {
      ok: true,
      percent: 100,
      progress: 100,
      done: true,
      token,
      note: "Scene anim render is not embedded; progress reports complete.",
    });
    return true;
  }

  // ── Settings (whole + namespaces) ───────────────────────────────────────
  if (p === `${BASE}/settings`) {
    if (method === "GET" || method === "HEAD") {
      sendJson(res, 200, { ok: true, settings: loadSettings(options) });
      return true;
    }
    if (method === "PUT" || method === "POST") {
      const body = await parseJsonBody(req);
      const next =
        body.settings && typeof body.settings === "object"
          ? (body.settings as Record<string, unknown>)
          : body;
      const merged = { ...loadSettings(options), ...next };
      const revision = saveSettings(options, merged);
      sendJson(res, 200, { ok: true, settings: merged, revision });
      return true;
    }
  }

  if (p.startsWith(`${BASE}/settings/`)) {
    const ns = p.slice(`${BASE}/settings/`.length).split("/")[0] ?? "";
    if (!SETTINGS_NAMESPACES.has(ns)) {
      if (method === "GET" || method === "HEAD") {
        sendJson(res, 200, {
          ok: true,
          settings: loadSettings(options),
          ignored: [ns],
          note: "Unknown settings namespace; returning full settings document.",
        });
        return true;
      }
    }
    if (method === "GET" || method === "HEAD") {
      sendJson(res, 200, { ok: true, namespace: ns, settings: loadSettings(options) });
      return true;
    }
    if (method === "PUT" || method === "POST") {
      const body = await parseJsonBody(req);
      const patch =
        body.settings && typeof body.settings === "object"
          ? (body.settings as Record<string, unknown>)
          : body;
      const ignored = Object.keys(patch).filter(() => false);
      const merged = { ...loadSettings(options), ...patch };
      const revision = saveSettings(options, merged);
      sendJson(res, 200, {
        ok: true,
        namespace: ns,
        settings: merged,
        revision,
        ...(ignored.length ? { ignored } : {}),
      });
      return true;
    }
  }

  // ── Inventory ───────────────────────────────────────────────────────────
  if (p === `${BASE}/inventory`) {
    const wallpapers = listWallpapers(options);
    const upload = uploadDir(options);
    sendJson(res, 200, {
      ok: true,
      installDir: rootDir(options),
      uploadDir: upload,
      cacheDir: cacheDir(options),
      weAssetsDir: null,
      weAssetsAvailable: false,
      sceneMediaBase: null,
      wallpapers,
      total: wallpapers.length,
      portableCount: wallpapers.length,
      playlists: [],
      note: "Steam Wallpaper Engine library scan is not applied; upload library only.",
    });
    return true;
  }

  // ── Upload / remove ─────────────────────────────────────────────────────
  if (p === `${BASE}/upload`) {
    if (method !== "POST" && method !== "PUT") {
      sendJson(res, 405, { ok: false, error: "POST required" });
      return true;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const title = url.searchParams.get("title")?.trim() || "upload";
    const ctype = (
      (req.headers["content-type"] ?? "application/octet-stream").split(
        ";",
      )[0] ?? "application/octet-stream"
    )
      .trim()
      .toLowerCase();
    const raw = await readBody(req);
    const extMatch =
      /\.(jpe?g|png|webp|mp4|webm|html?)$/i.exec(title) ||
      (ctype.includes("jpeg")
        ? [".jpg"]
        : ctype.includes("png")
          ? [".png"]
          : ctype.includes("webp")
            ? [".webp"]
            : ctype.includes("mp4")
              ? [".mp4"]
              : ctype.includes("webm")
                ? [".webm"]
                : null);
    const ext = (extMatch?.[0] ?? ".bin").toLowerCase();
    const id = uploadIdFor(Buffer.from(raw), ext);
    const dest = path.join(uploadDir(options), id);
    let duplicate = false;
    if (existsSync(dest)) {
      duplicate = true;
    } else {
      writeFileSync(dest, raw);
    }
    sendJson(res, 200, {
      ok: true,
      id,
      title,
      duplicate,
      type: uploadType(id),
      media: `${BASE}/media/${encodeURIComponent(id)}`,
    });
    return true;
  }

  if (p === `${BASE}/upload-dir`) {
    if (method === "POST" || method === "PUT") await parseJsonBody(req);
    sendJson(res, 200, {
      ok: true,
      uploadDir: uploadDir(options),
      note: "Changing the upload root is not supported; custom uploads stay under the Host data dir.",
    });
    return true;
  }

  if (p === `${BASE}/remove`) {
    if (method === "POST" || method === "PUT") {
      const body = await parseJsonBody(req);
      const id = typeof body.id === "string" ? path.basename(body.id) : "";
      const abs = path.join(uploadDir(options), id);
      if (id && existsSync(abs)) unlinkSync(abs);
      sendJson(res, 200, { ok: true, id });
      return true;
    }
  }

  // ── Media / preview bytes (upload tokens only) ──────────────────────────
  if (p.startsWith(`${BASE}/media/`) || p.startsWith(`${BASE}/preview/`)) {
    const prefix = p.startsWith(`${BASE}/media/`)
      ? `${BASE}/media/`
      : `${BASE}/preview/`;
    const id = path.basename(tokenTail(p, prefix));
    const abs = path.join(uploadDir(options), id);
    if (!id || !existsSync(abs)) {
      sendJson(res, 404, {
        ok: false,
        error: "media-not-found",
        note: "Only upload-library tokens are served; Steam WE mediaMap tokens are unavailable without Cordis host apply.",
      });
      return true;
    }
    sendFileBytes(res, method, abs, contentTypeFor(id));
    return true;
  }

  // ── Transcode / media-info family ───────────────────────────────────────
  if (
    p.startsWith(`${BASE}/transcoded/`) ||
    p.startsWith(`${BASE}/transcode-progress/`) ||
    p.startsWith(`${BASE}/media-info`) ||
    p.startsWith(`${BASE}/video-preview/`)
  ) {
    if (p.startsWith(`${BASE}/transcode-progress/`)) {
      sendJson(res, 200, {
        ok: true,
        percent: 100,
        done: true,
        note: "ffmpeg transcode is not embedded; reporting idle-complete.",
      });
      return true;
    }
    refuse(
      res,
      "ffmpeg media-derived routes are not bridged on XRK Host.",
      { path: p },
    );
    return true;
  }

  // ── Now-playing / media bridge ──────────────────────────────────────────
  if (
    p === `${BASE}/media-status` ||
    p === `${BASE}/audio-spectrum` ||
    p === `${BASE}/now-playing` ||
    p === `${BASE}/media-control`
  ) {
    if (p === `${BASE}/audio-spectrum`) {
      sendJson(res, 200, {
        ok: true,
        bands: [],
        note: "System audio spectrum is not bridged.",
      });
      return true;
    }
    if (p === `${BASE}/media-control` && (method === "POST" || method === "PUT")) {
      await parseJsonBody(req);
      refuse(res, "media-control has no system media session on XRK Host.");
      return true;
    }
    sendJson(res, 200, idleNowPlaying());
    return true;
  }

  if (p.startsWith(`${BASE}/now-playing/artwork`)) {
    sendPlaceholderPng(res, method);
    return true;
  }

  // ── Fonts / glass / mascot / diag / dirs ────────────────────────────────
  if (p === `${BASE}/system-fonts`) {
    sendJson(res, 200, {
      ok: true,
      fonts: [],
      note: "Host-side font enumeration is not bridged; client falls back to built-in stacks.",
    });
    return true;
  }

  if (p === `${BASE}/fontsets`) {
    sendJson(res, 200, { ok: true, sets: [], note: "No custom fontsets staged." });
    return true;
  }

  if (p === `${BASE}/glass-presets` || p === `${BASE}/glass-row-state`) {
    sendJson(res, 200, {
      ok: true,
      presets: [],
      note: "Glass subpackage routes are not applied; UI uses client defaults.",
    });
    return true;
  }

  if (
    p === `${BASE}/mascot` ||
    p.startsWith(`${BASE}/mascot/`) ||
    p === `${BASE}/avatar` ||
    p.startsWith(`${BASE}/avatar/`) ||
    p === `${BASE}/rope-art` ||
    p.startsWith(`${BASE}/rope-art/`)
  ) {
    if (method === "GET" || method === "HEAD") {
      sendPlaceholderPng(res, method);
      return true;
    }
    if (method === "POST" || method === "PUT") await readBody(req);
    refuse(res, "Mascot/avatar upload host half is not applied.", { path: p });
    return true;
  }

  if (
    p === `${BASE}/diag` ||
    p === `${BASE}/diag-log` ||
    p === `${BASE}/client-diag` ||
    p.startsWith(`${BASE}/diag`)
  ) {
    sendJson(res, 200, {
      ok: true,
      bridge: "xrk-wallpaper",
      components: [],
      note: "Cordis wallpaper host components are not loaded; diag is empty.",
    });
    return true;
  }

  if (p === `${BASE}/cache-dir` || p.startsWith(`${BASE}/cache-dir/`)) {
    if (method === "POST" || method === "PUT") await parseJsonBody(req);
    sendJson(res, 200, {
      ok: true,
      cacheDir: cacheDir(options),
      note: "Cache root is Host-managed under ~/.xrk; relocating is not supported.",
    });
    return true;
  }

  if (p === `${BASE}/we-assets-dir` || p === `${BASE}/media-origin`) {
    if (method === "POST" || method === "PUT") await parseJsonBody(req);
    sendJson(res, 200, {
      ok: true,
      weAssetsAvailable: false,
      weAssetsDir: null,
      mediaOrigin: null,
      note: "Wallpaper Engine asset directory / media-origin loopback are not bridged.",
    });
    return true;
  }

  if (
    p.startsWith(`${BASE}/scene-live`) ||
    p.startsWith(`${BASE}/scene-files`) ||
    p.startsWith(`${BASE}/scene-video`) ||
    p.startsWith(`${BASE}/scene-audio`) ||
    p.startsWith(`${BASE}/scene-payload-progress`) ||
    p.startsWith(`${BASE}/props/`)
  ) {
    if (p.startsWith(`${BASE}/scene-payload-progress`)) {
      sendJson(res, 200, { ok: true, percent: 100, done: true });
      return true;
    }
    refuse(
      res,
      "Scene WebWallGL / pkg media routes require the upstream Cordis host half.",
      { path: p },
    );
    return true;
  }

  if (p === `${BASE}/occlusion` || p.startsWith(`${BASE}/pet-link/`)) {
    refuse(res, "Occlusion / pet-link subpackages are not applied.", { path: p });
    return true;
  }

  if (p === `${BASE}/star-count` || p === `${BASE}/about-qr`) {
    refuse(res, "About-notice subpackage is not applied.", { path: p });
    return true;
  }

  if (p === "/api/local-assets" || p.startsWith("/api/local-assets/")) {
    sendJson(res, 200, {
      ok: false,
      available: false,
      names: [],
      note: "WE local-assets directory is not configured on XRK Host.",
    });
    return true;
  }

  if (method === "POST" || method === "PUT") await readBody(req);
  refuse(res, "Unhandled wallpaper-engine path on XRK bridge.", { path: p });
  return true;
}
