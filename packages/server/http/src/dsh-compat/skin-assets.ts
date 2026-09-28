/**
 * Community skin raster assets (`/skin-assets/<skinId>/<hash>.png|.webp`).
 *
 * DSH skins (maid-atelier · linxin skins · deep-whale …) register a Cordis
 * webServer prefix from their host half. XRK stages `assets/runtime/` next to
 * client.js and serves the same URL shape without embedding Cordis Host.
 */
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface SkinAssetsOptions {
  readonly pluginsDir?: string;
}

const HASH_FILE = /^[a-f0-9]{64}\.(png|webp)$/;

interface SkinRoot {
  readonly skinId: string;
  readonly runtimeDir: string;
}

let cachedPluginsDir: string | undefined;
let cachedAt = 0;
let cachedRoots: readonly SkinRoot[] = [];

function contentType(file: string): string {
  return file.endsWith(".webp") ? "image/webp" : "image/png";
}

function tryReadSkinId(dir: string): string | undefined {
  const skinJson = path.join(dir, "skin.json");
  if (!existsSync(skinJson)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(skinJson, "utf8")) as { id?: unknown };
    return typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : undefined;
  } catch {
    return undefined;
  }
}

function collectSkinRoots(pluginsDir: string): SkinRoot[] {
  const web = path.join(pluginsDir, "web", "plugins");
  if (!existsSync(web)) return [];
  const out: SkinRoot[] = [];

  const visit = (dir: string): void => {
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const runtime = path.join(dir, "assets", "runtime");
    if (existsSync(runtime)) {
      const fromJson = tryReadSkinId(dir);
      const basenames = new Set<string>();
      if (fromJson) basenames.add(fromJson);
      // Package folder heuristics: …/dsh-client-ui-skin-maid-atelier → maid-atelier
      const base = path.basename(dir);
      const stripped = base
        .replace(/^dsh-client-ui-skin-/, "")
        .replace(/^dsh-skin-/, "")
        .replace(/^ui-skin-/, "");
      if (stripped && stripped !== base) basenames.add(stripped);
      if (/^[a-z][a-z0-9-]*$/.test(base)) basenames.add(base);
      for (const skinId of basenames) {
        out.push({ skinId, runtimeDir: runtime });
      }
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name === "node_modules" || ent.name === "chunks") continue;
      visit(path.join(dir, ent.name));
    }
  };

  visit(web);
  return out;
}

function skinRoots(options: SkinAssetsOptions): readonly SkinRoot[] {
  const pluginsDir = options.pluginsDir?.trim();
  if (!pluginsDir) return [];
  const now = Date.now();
  if (cachedPluginsDir === pluginsDir && now - cachedAt < 5_000) {
    return cachedRoots;
  }
  cachedPluginsDir = pluginsDir;
  cachedAt = now;
  cachedRoots = collectSkinRoots(pluginsDir);
  return cachedRoots;
}

function resolveRuntimeFile(
  options: SkinAssetsOptions,
  skinId: string,
  file: string,
): string | undefined {
  if (!HASH_FILE.test(file)) return undefined;
  for (const root of skinRoots(options)) {
    if (root.skinId !== skinId) continue;
    const abs = path.join(root.runtimeDir, file);
    const base = path.resolve(root.runtimeDir);
    const target = path.resolve(abs);
    if (!target.startsWith(base + path.sep) && target !== base) continue;
    try {
      if (statSync(abs).isFile()) return abs;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

export function isSkinAssetsPath(pathname: string): boolean {
  return pathname === "/skin-assets" || pathname.startsWith("/skin-assets/");
}

/**
 * Serve hashed skin artwork. Returns true when the path is under `/skin-assets`.
 */
export async function handleSkinAssetsHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: SkinAssetsOptions = {},
): Promise<boolean> {
  if (!isSkinAssetsPath(pathname)) return false;
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return true;
  }

  const parts = pathname.split("/").filter(Boolean);
  // skin-assets / <skinId> / <file>
  if (parts.length !== 3) {
    res.writeHead(404).end();
    return true;
  }
  const skinId = parts[1]!;
  const file = parts[2]!;
  const abs = resolveRuntimeFile(options, skinId, file);
  if (!abs) {
    res.writeHead(404).end();
    return true;
  }

  const st = statSync(abs);
  const etag = `"${file.split(".")[0]}"`;
  const headers: Record<string, string> = {
    "Content-Type": contentType(file),
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    ETag: etag,
    "Content-Length": String(st.size),
  };
  const inm = req.headers["if-none-match"];
  if (
    typeof inm === "string" &&
    inm.split(",").some((value) => {
      const v = value.trim().replace(/^W\//, "");
      return v === etag || v === "*";
    })
  ) {
    res.writeHead(304, headers).end();
    return true;
  }
  res.writeHead(200, headers);
  if (method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(abs).pipe(res);
  return true;
}

/** Test helper — drop the skin-root cache between cases. */
export function resetSkinAssetsCacheForTest(): void {
  cachedPluginsDir = undefined;
  cachedAt = 0;
  cachedRoots = [];
}
