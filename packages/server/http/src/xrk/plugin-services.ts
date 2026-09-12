/**
 * XRK-native plugin inventory + community catalog (底层能力).
 * DSH market adapters map onto these shapes — do not put `/dsh-*` paths here.
 */
import { homedir } from "node:os";
import path from "node:path";
import {
  readDisabledPluginIdsAt,
  readManagedPluginPackagesAt,
} from "@xrkseek/server-loader";
import type { Json } from "../http-json.js";

export interface XrkInstalledPackage {
  readonly name: string;
  readonly version: string;
  readonly kind: string;
  readonly source?: string;
  readonly installedAt?: string;
}

export interface XrkPluginInventory {
  readonly pluginsDir: string;
  readonly packages: readonly XrkInstalledPackage[];
  /** name → { version, kind } — DSH market `installed` map shape */
  readonly installedMap: Readonly<
    Record<string, { readonly version?: string; readonly kind?: string }>
  >;
  readonly present: readonly string[];
}

export interface XrkPluginServicesOptions {
  readonly pluginsDir?: string;
  readonly xrkHome?: string;
}

const AWESOME_URL = "https://awesome-dsh-plugin.com/plugins.json";
let cachedCatalog: Json | undefined;
let cachedCatalogAt = 0;
const CATALOG_TTL_MS = 10 * 60 * 1000;

export function resolvePluginsDir(
  options: XrkPluginServicesOptions = {},
): string {
  if (options.pluginsDir?.trim()) {
    return path.resolve(options.pluginsDir.trim());
  }
  const home =
    options.xrkHome?.trim() ||
    process.env.XRK_HOME?.trim() ||
    process.env.XRK_DSH_HOME?.trim() ||
    process.env.DSH_HOME?.trim();
  if (home) return path.join(path.resolve(home), "plugins");
  return path.join(homedir(), ".xrk", "plugins");
}

/** Soft-disabled managed plugin ids (shared loader disk contract). */
export function readXrkDisabledPluginIds(
  options: XrkPluginServicesOptions = {},
): readonly string[] {
  return [...readDisabledPluginIdsAt(resolvePluginsDir(options))].sort();
}

/** Read CLI inventory `{pluginsDir}/.xrk-plugins.json`. */
export function readXrkPluginInventory(
  options: XrkPluginServicesOptions = {},
): XrkPluginInventory {
  const pluginsDir = resolvePluginsDir(options);
  const packages: XrkInstalledPackage[] = [];
  const installedMap: Record<string, { version?: string; kind?: string }> = {};
  const present: string[] = [];

  for (const [name, entry] of readManagedPluginPackagesAt(pluginsDir)) {
    const version = entry.version ?? "0.0.0";
    const kind = entry.kind ?? "unknown";
    packages.push({
      name,
      version,
      kind,
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.installedAt ? { installedAt: entry.installedAt } : {}),
    });
    installedMap[name] = { version, kind };
    present.push(name);
  }

  return { pluginsDir, packages, installedMap, present };
}

/** Community catalog (awesome-dsh-plugin.com) — shared by `/xrk/plugins/catalog`. */
export async function fetchXrkPluginCatalog(): Promise<{
  readonly catalog: Json;
  readonly source: string;
  readonly cached: boolean;
}> {
  const now = Date.now();
  if (
    cachedCatalog !== undefined &&
    now - cachedCatalogAt < CATALOG_TTL_MS
  ) {
    return { catalog: cachedCatalog, source: AWESOME_URL, cached: true };
  }
  const res = await fetch(AWESOME_URL, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`plugin catalog HTTP ${res.status}`);
  }
  const catalog = (await res.json()) as Json;
  cachedCatalog = catalog;
  cachedCatalogAt = now;
  return { catalog, source: AWESOME_URL, cached: false };
}

/** Settings namespaces commonly declared by installed DSH client plugins. */
export const DSH_SETTINGS_NAMESPACES = [
  "mnemon",
  "mnemon-ui",
  "vision-router",
  "chat-import",
  "costMeter",
  "lyrics",
  "query",
  "redo",
  "text",
  "undo",
  "usagePrompt",
  "genui-design",
  "image-generation",
  "modlens",
  "modsearch",
  "noema-memory",
  "settings.dreamSkin",
  "tokenLedger",
  "wallpaper-engine",
] as const;

export { DSH_SETTINGS_DEFAULTS } from "../dsh-compat/settings-defaults.js";
