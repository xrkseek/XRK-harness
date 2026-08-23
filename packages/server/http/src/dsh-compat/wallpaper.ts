/**
 * dsh-plugin-wallpaper-engine file-backed settings + inventory.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readBody, sendJson } from "../http-json.js";
import { dataPath } from "./json-store.js";
import { tag } from "./meta.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { parseJsonBody } from "./underlying/http-kit.js";

export interface WallpaperOptions {
  readonly xrkHome?: string;
}

const DEFAULT_SETTINGS = {
  scrim: 0.25,
  border: 0.35,
  blur: 16,
  wallpaperBlur: 0,
  rotationEnabled: false,
  rotationInterval: 30,
  rotationGroupId: "",
  rotationGroups: [] as unknown[],
  rotationSeeded: false,
  hiddenIds: [] as string[],
  playbackRate: 1,
  flip: false,
  objectFit: "cover",
  contentRatingFilter: "everyone",
  wallpaperTypeFilter: "all",
  activeId: null as string | null,
  activeKind: null as string | null,
};

interface WallpaperSettingsDoc {
  settings: Record<string, unknown>;
}

const EMPTY_SETTINGS_DOC: WallpaperSettingsDoc = {
  settings: { ...DEFAULT_SETTINGS },
};

function rootDir(options: WallpaperOptions): string {
  return dataPath(options.xrkHome, "wallpaper-engine");
}

function uploadDir(options: WallpaperOptions): string {
  const dir = path.join(rootDir(options), "uploads");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const WALLPAPER_SETTINGS_STORE = createXrkDocStore(
  ["wallpaper-engine", "config.json"],
  EMPTY_SETTINGS_DOC,
);

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

function listWallpapers(options: WallpaperOptions): unknown[] {
  const dir = uploadDir(options);
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
        path: abs,
        bytes: st.size,
      });
    } catch {
      /* skip */
    }
  }
  return out;
}

function uploadIdFor(bytes: Buffer, ext: string): string {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  return `up-${hash}${ext}`;
}

export async function handleWallpaperHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: WallpaperOptions,
): Promise<boolean> {
  if (!pathname.startsWith("/wallpaper-engine")) return false;
  const method = (req.method ?? "GET").toUpperCase();

  if (pathname === "/wallpaper-engine/settings") {
    if (method === "GET" || method === "HEAD") {
      sendJson(res, 200, { settings: loadSettings(options) });
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
      sendJson(res, 200, { settings: merged, revision });
      return true;
    }
  }

  if (pathname === "/wallpaper-engine/inventory") {
    const wallpapers = listWallpapers(options);
    const upload = uploadDir(options);
    sendJson(res, 200, {
      installDir: rootDir(options),
      uploadDir: upload,
      wallpapers,
      total: wallpapers.length,
      portableCount: 0,
      playlists: [],
    });
    return true;
  }

  if (pathname === "/wallpaper-engine/upload") {
    if (method !== "POST" && method !== "PUT") {
      sendJson(res, 405, { error: "POST required" });
      return true;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const title = url.searchParams.get("title")?.trim() || "upload";
    const ctype = ((req.headers["content-type"] ?? "application/octet-stream").split(";")[0] ?? "application/octet-stream")
      .trim()
      .toLowerCase();
    const raw = await readBody(req);
    const extMatch = /\.(jpe?g|png|mp4)$/i.exec(title) ||
      (ctype.includes("jpeg") ? [".jpg"] : ctype.includes("png") ? [".png"] : ctype.includes("mp4") ? [".mp4"] : null);
    const ext = (extMatch?.[0] ?? ".bin").toLowerCase();
    const id = uploadIdFor(Buffer.from(raw), ext);
    const dest = path.join(uploadDir(options), id);
    let duplicate = false;
    if (existsSync(dest)) {
      duplicate = true;
    } else {
      writeFileSync(dest, raw);
    }
    sendJson(res, 200, { id, title, duplicate });
    return true;
  }

  if (pathname === "/wallpaper-engine/upload-dir") {
    sendJson(res, 200, {
      ok: true,
      uploadDir: uploadDir(options),
      note: "Batch directory upload is not supported in web shell; use single upload.",
    });
    return true;
  }

  if (pathname === "/wallpaper-engine/remove") {
    if (method === "POST" || method === "PUT") {
      const body = await parseJsonBody(req);
      const id = typeof body.id === "string" ? path.basename(body.id) : "";
      const abs = path.join(uploadDir(options), id);
      if (existsSync(abs)) unlinkSync(abs);
      sendJson(res, 200, { ok: true, id });
      return true;
    }
  }

  if (method === "POST" || method === "PUT") await readBody(req);
  sendJson(res, 200, tag({ path: pathname }, ["wallpaper-host"]));
  return true;
}
