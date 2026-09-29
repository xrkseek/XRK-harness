/**
 * Discover installed community skins under `{pluginsDir}/web/plugins`.
 * Shared by `/api/dsh/skins`, `/api/skin-center`, `/dsh-skin-market`, and audits.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  readXrkPluginInventory,
  resolvePluginsDir,
  type XrkPluginServicesOptions,
} from "../xrk/plugin-services.js";

export type SkinDiscoverOptions = XrkPluginServicesOptions;

/** Heuristic package-name hints when `skin.json` is absent. */
export const SKIN_NAME_HINTS = [
  "skin",
  "dream-skin",
  "liang-intensity",
  "whale-girl",
  "whale",
  "maid",
  "atelier",
  "theme",
  "beauty",
  "endfield",
  "deep-whale",
  "open-sea",
  "custom-skin",
  "aqua",
  "orca",
] as const;

export interface DiscoveredSkin {
  readonly id: string;
  readonly name: string;
  readonly nameEn?: string;
  readonly tagline?: string;
  readonly taglineEn?: string;
  readonly packageName: string;
  readonly version: string;
  readonly bodyAttr?: string;
  readonly wiringId?: string;
  readonly dshCompatibility?: string;
  readonly accent?: string;
  readonly dir: string;
  readonly manifest: Record<string, unknown>;
  /** skin-center v2 manifests carry `contributes`. */
  readonly channel?: string;
  readonly origin: "plugin" | "bundled";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function isSkinPackageName(id: string): boolean {
  const lower = id.toLowerCase();
  return SKIN_NAME_HINTS.some((h) => lower.includes(h));
}

function packageNameFromDir(pluginsWeb: string, dir: string): string {
  const rel = path.relative(pluginsWeb, dir).split(path.sep).join("/");
  return rel || path.basename(dir);
}

function readPackageVersion(dir: string): string {
  try {
    const raw = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    ) as { version?: unknown };
    return asString(raw.version) ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function parseSkinJson(
  dir: string,
  packageName: string,
  origin: DiscoveredSkin["origin"],
  channel?: string,
): DiscoveredSkin | undefined {
  const skinJson = path.join(dir, "skin.json");
  if (!existsSync(skinJson)) return undefined;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(skinJson, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const id = asString(raw.id);
  const name = asString(raw.name);
  if (!id || !name) return undefined;

  const wiring = asRecord(raw.wiring);
  const declaredPackage = asString(raw.package) ?? packageName;
  const version = asString(raw.version) ?? readPackageVersion(dir);
  const nameEn = asString(raw.nameEn);
  const tagline = asString(raw.tagline);
  const taglineEn = asString(raw.taglineEn);
  const bodyAttr = asString(raw.bodyAttr);
  const wiringId = asString(wiring?.id);
  const dshCompatibility = asString(raw.dshCompatibility);
  const accent = asString(raw.accent);

  return {
    id,
    name,
    ...(nameEn ? { nameEn } : {}),
    ...(tagline ? { tagline } : {}),
    ...(taglineEn ? { taglineEn } : {}),
    packageName: declaredPackage,
    version,
    ...(bodyAttr ? { bodyAttr } : {}),
    ...(wiringId ? { wiringId } : {}),
    ...(dshCompatibility ? { dshCompatibility } : {}),
    ...(accent ? { accent } : {}),
    dir,
    manifest: raw,
    ...(channel ? { channel } : {}),
    origin,
  };
}

function visitPluginTree(
  pluginsWeb: string,
  dir: string,
  out: Map<string, DiscoveredSkin>,
): void {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const packageName = packageNameFromDir(pluginsWeb, dir);
  const rootSkin = parseSkinJson(dir, packageName, "plugin");
  if (rootSkin && !out.has(rootSkin.id)) {
    out.set(rootSkin.id, rootSkin);
  }

  // Bundled skins next to a manager/center package: `skins/<id>/skin.json`
  const skinsDir = path.join(dir, "skins");
  if (existsSync(skinsDir)) {
    try {
      for (const ent of readdirSync(skinsDir, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const nested = path.join(skinsDir, ent.name);
        const nestedSkin = parseSkinJson(
          nested,
          `${packageName}/skins/${ent.name}`,
          "bundled",
          "bundled",
        );
        if (nestedSkin && !out.has(nestedSkin.id)) {
          out.set(nestedSkin.id, nestedSkin);
        }
      }
    } catch {
      /* skip */
    }
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (
      ent.name === "node_modules" ||
      ent.name === "chunks" ||
      ent.name === "assets" ||
      ent.name === "skins" ||
      ent.name === "preview" ||
      ent.name === "locale" ||
      ent.name === "kws" ||
      ent.name === "static"
    ) {
      continue;
    }
    visitPluginTree(pluginsWeb, path.join(dir, ent.name), out);
  }
}

/**
 * Scan staged client plugins for `skin.json` (root or bundled `skins/*`).
 * Later plugin roots win over bundled duplicates with the same id.
 */
export function discoverInstalledSkins(
  options: SkinDiscoverOptions = {},
): DiscoveredSkin[] {
  const pluginsDir = resolvePluginsDir(options);
  const web = path.join(pluginsDir, "web", "plugins");
  const byId = new Map<string, DiscoveredSkin>();
  if (existsSync(web)) {
    visitPluginTree(web, web, byId);
  }

  // Prefer inventory package versions when present.
  const inv = readXrkPluginInventory(options);
  for (const skin of byId.values()) {
    const fromInv = inv.installedMap[skin.packageName]?.version;
    if (fromInv && skin.version === "0.0.0") {
      byId.set(skin.id, { ...skin, version: fromInv });
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function findSkinById(
  options: SkinDiscoverOptions,
  id: string,
): DiscoveredSkin | undefined {
  return discoverInstalledSkins(options).find((s) => s.id === id);
}

/** Resolve a path under a skin dir; rejects traversal. */
export function resolveSkinRelative(
  skinDir: string,
  rel: string,
): string | undefined {
  if (!rel || rel.includes("\0") || path.isAbsolute(rel)) return undefined;
  const target = path.resolve(skinDir, rel);
  const base = path.resolve(skinDir);
  if (target !== base && !target.startsWith(base + path.sep)) return undefined;
  try {
    if (statSync(target).isFile()) return target;
  } catch {
    return undefined;
  }
  return undefined;
}
