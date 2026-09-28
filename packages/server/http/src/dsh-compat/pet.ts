/**
 * @linxin666/dsh-pet — `/api/pet/*` · `/pet/*` asset + runtime shapes the client expects.
 * When the pack is staged under pluginsDir, serve real assets; otherwise honest defaults.
 */
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { findCommunityPluginRoot } from "./community-plugin-root.js";

export interface PetHttpOptions {
  readonly pluginsDir?: string;
  readonly xrkHome?: string;
}

interface PetDisplay {
  visible: boolean;
  size: number;
  right: number;
  bottom: number;
  bubbleScale: number;
}

interface PetPersist {
  petId: string;
  display: PetDisplay;
  names: Record<string, string>;
}

interface PetEntry {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly renderer: "sprite2d" | "live2d";
  readonly folder: string;
  readonly atlasUrl?: string;
  readonly manifestUrl?: string;
}

const DEFAULT_DISPLAY: PetDisplay = {
  visible: true,
  size: 160,
  right: 24,
  bottom: 120,
  bubbleScale: 1,
};

const FALLBACK_ENTRY: PetEntry = {
  id: "whale-girl",
  displayName: "鲸鱼娘",
  description: "XRK compat default pet",
  renderer: "sprite2d",
  folder: "whale",
  atlasUrl: "/pet/whale/spritesheet.webp",
  manifestUrl: "/pet/whale/pet.json",
};

const STORE = createXrkDocStore<PetPersist>(["dsh-pet", "pet.json"], {
  petId: FALLBACK_ENTRY.id,
  display: { ...DEFAULT_DISPLAY },
  names: {},
});

function contentType(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".webp":
      return "image/webp";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".css":
      return "text/css; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function sendFile(
  res: ServerResponse,
  abs: string,
  method: string,
): boolean {
  try {
    const st = statSync(abs);
    if (!st.isFile()) return false;
    res.writeHead(200, {
      "content-type": contentType(abs),
      "content-length": String(st.size),
      "cache-control": "no-store",
    });
    if (method === "HEAD") {
      res.end();
      return true;
    }
    createReadStream(abs).pipe(res);
    return true;
  } catch {
    return false;
  }
}

function sendText(
  res: ServerResponse,
  status: number,
  body: string,
  type: string,
): void {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function packageRoot(options: PetHttpOptions): string | undefined {
  return findCommunityPluginRoot(options.pluginsDir, [
    "@linxin666/dsh-pet",
    "dsh-pet",
  ]);
}

function loadEntries(root: string | undefined): PetEntry[] {
  if (!root) return [FALLBACK_ENTRY];
  const assets = path.join(root, "assets");
  if (!existsSync(assets)) return [FALLBACK_ENTRY];
  const out: PetEntry[] = [];
  try {
    for (const ent of readdirSync(assets, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      if (ent.name === "decorations") continue;
      const folder = ent.name;
      const manifestPath = path.join(assets, folder, "pet.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
          string,
          unknown
        >;
        const id = typeof raw.id === "string" ? raw.id : folder;
        const displayName =
          typeof raw.displayName === "string" ? raw.displayName : id;
        const description =
          typeof raw.description === "string" ? raw.description : undefined;
        const sheet =
          existsSync(path.join(assets, folder, "spritesheet.webp"))
            ? "spritesheet.webp"
            : existsSync(path.join(assets, folder, "spritesheet.png"))
              ? "spritesheet.png"
              : undefined;
        out.push({
          id,
          displayName,
          ...(description ? { description } : {}),
          renderer: "sprite2d",
          folder,
          ...(sheet
            ? { atlasUrl: `/pet/${folder}/${sheet}` }
            : {}),
          manifestUrl: `/pet/${folder}/pet.json`,
        });
      } catch {
        /* skip bad manifest */
      }
    }
  } catch {
    return [FALLBACK_ENTRY];
  }
  return out.length > 0 ? out : [FALLBACK_ENTRY];
}

function readPersist(options: PetHttpOptions): PetPersist {
  const doc = STORE.read(options.xrkHome);
  return {
    petId: doc.data.petId || FALLBACK_ENTRY.id,
    display: { ...DEFAULT_DISPLAY, ...doc.data.display },
    names: { ...doc.data.names },
  };
}

function writePersist(options: PetHttpOptions, next: PetPersist): void {
  STORE.write(options.xrkHome, next);
}

function entryView(entry: PetEntry): Record<string, unknown> {
  return {
    id: entry.id,
    displayName: entry.displayName,
    ...(entry.description ? { description: entry.description } : {}),
    renderer: entry.renderer,
    ...(entry.atlasUrl ? { atlasUrl: entry.atlasUrl } : {}),
    ...(entry.manifestUrl ? { manifestUrl: entry.manifestUrl } : {}),
  };
}

function stateBody(
  options: PetHttpOptions,
  entries: PetEntry[],
): Record<string, unknown> {
  const persist = readPersist(options);
  const entry =
    entries.find((e) => e.id === persist.petId) ?? entries[0] ?? FALLBACK_ENTRY;
  const name = persist.names[entry.id]?.trim() || entry.displayName;
  return {
    animation: "idle",
    phase: "idle",
    sessionActive: false,
    sessions: [],
    affinity: {
      points: 0,
      rank: "stranger",
      rankEmoji: "👋",
      pets: 0,
      feeds: 0,
      turns: 0,
      petCooldown: false,
      feedCooldown: false,
    },
    display: persist.display,
    pet: {
      id: entry.id,
      displayName: entry.displayName,
      ...(entry.description ? { description: entry.description } : {}),
    },
    name,
    treats: { stocked: 3, max: 10 },
    adapter: DSH_COMPAT_ADAPTER,
  };
}

async function parseJson(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  try {
    const raw = await readBody(req);
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function resolvePetAsset(
  root: string | undefined,
  pathname: string,
): string | undefined {
  if (!root) return undefined;
  // /pet/<folder>/...
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "pet" || parts.length < 3) return undefined;
  const folder = parts[1]!;
  const rel = parts.slice(2).join("/");
  if (!folder || !rel || rel.includes("..") || path.isAbsolute(rel)) {
    return undefined;
  }
  const abs = path.resolve(root, "assets", folder, rel);
  const base = path.resolve(root, "assets", folder);
  if (abs !== base && !abs.startsWith(base + path.sep)) return undefined;
  return existsSync(abs) ? abs : undefined;
}

export function isPetHttpPath(pathname: string): boolean {
  return (
    pathname === "/api/pet" ||
    pathname.startsWith("/api/pet/") ||
    pathname === "/pet" ||
    pathname.startsWith("/pet/")
  );
}

export async function handlePetHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: PetHttpOptions = {},
): Promise<boolean> {
  if (!isPetHttpPath(pathname)) return false;
  const method = (req.method ?? "GET").toUpperCase();
  const root = packageRoot(options);
  const entries = loadEntries(root);

  if (pathname.startsWith("/pet/")) {
    if (method !== "GET" && method !== "HEAD") {
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return true;
    }
    const abs = resolvePetAsset(root, pathname);
    if (abs && sendFile(res, abs, method)) return true;
    sendJson(res, 404, {
      ok: false,
      error: "pet asset not found",
      path: pathname,
      adapter: DSH_COMPAT_ADAPTER,
      note: root
        ? "Asset missing in staged dsh-pet package."
        : "Install @linxin666/dsh-pet to serve pet assets.",
    });
    return true;
  }

  if (pathname.startsWith("/api/pet/runtime/")) {
    if (method !== "GET" && method !== "HEAD") {
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return true;
    }
    const name = pathname.slice("/api/pet/runtime/".length);
    if (name.includes("..") || path.isAbsolute(name)) {
      sendJson(res, 400, { ok: false, error: "bad runtime path" });
      return true;
    }
    if (root) {
      const abs = path.join(root, "lib", name);
      if (sendFile(res, abs, method)) return true;
    }
    sendText(
      res,
      200,
      `/* xrk-dsh-compat: ${name} not bundled; Live2D runtime optional */\n`,
      "application/javascript; charset=utf-8",
    );
    return true;
  }

  if (pathname === "/api/pet/state" || pathname === "/api/pet/state/") {
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      await readBody(req);
    }
    sendJson(res, 200, stateBody(options, entries));
    return true;
  }

  if (pathname === "/api/pet/pets" || pathname === "/api/pet/pets/") {
    sendJson(res, 200, entries.map(entryView));
    return true;
  }

  if (pathname === "/api/pet/diagnostics") {
    sendJson(res, 200, {
      diagnostics: {
        adapter: DSH_COMPAT_ADAPTER,
        packageRoot: root ?? null,
        entries: entries.length,
      },
    });
    return true;
  }

  if (method === "POST") {
    const body = await parseJson(req);
    const persist = readPersist(options);

    if (pathname === "/api/pet/set-visible") {
      const visible = body.visible === true;
      const next = {
        ...persist,
        display: { ...persist.display, visible },
      };
      writePersist(options, next);
      sendJson(res, 200, { ok: true, display: next.display });
      return true;
    }

    if (pathname === "/api/pet/set-pet") {
      const petId = typeof body.petId === "string" ? body.petId : "";
      const entry = entries.find((e) => e.id === petId);
      if (!entry) {
        sendJson(res, 200, { ok: false, error: "unknown-pet" });
        return true;
      }
      writePersist(options, { ...persist, petId: entry.id });
      sendJson(res, 200, { ok: true, petId: entry.id });
      return true;
    }

    if (pathname === "/api/pet/set-config") {
      const patch = body as Partial<PetDisplay>;
      const display = { ...persist.display };
      if (typeof patch.visible === "boolean") display.visible = patch.visible;
      if (typeof patch.size === "number" && Number.isFinite(patch.size)) {
        display.size = patch.size;
      }
      if (typeof patch.right === "number" && Number.isFinite(patch.right)) {
        display.right = patch.right;
      }
      if (typeof patch.bottom === "number" && Number.isFinite(patch.bottom)) {
        display.bottom = patch.bottom;
      }
      if (
        typeof patch.bubbleScale === "number" &&
        Number.isFinite(patch.bubbleScale)
      ) {
        display.bubbleScale = patch.bubbleScale;
      }
      const next = { ...persist, display };
      writePersist(options, next);
      sendJson(res, 200, { ok: true, display });
      return true;
    }

    if (pathname === "/api/pet/set-name") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const petId = persist.petId;
      const next = {
        ...persist,
        names: { ...persist.names, ...(name ? { [petId]: name } : {}) },
      };
      if (!name) delete next.names[petId];
      writePersist(options, next);
      sendJson(res, 200, { ok: true, name: name || undefined });
      return true;
    }

    if (pathname === "/api/pet/interact") {
      sendJson(res, 200, {
        ok: true,
        reaction: "idle",
        delta: 0,
        affinity: stateBody(options, entries).affinity,
      });
      return true;
    }

    if (
      pathname === "/api/pet/set-skin" ||
      pathname.startsWith("/api/pet/gameplay/")
    ) {
      sendJson(res, 200, {
        ok: true,
        path: pathname,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
  }

  if (method === "GET" || method === "HEAD") {
    sendJson(res, 200, {
      ok: true,
      path: pathname,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  sendJson(res, 405, { ok: false, error: "method not allowed" });
  return true;
}
