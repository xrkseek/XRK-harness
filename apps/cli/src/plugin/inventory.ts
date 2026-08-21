/**
 * Inventory of CLI-installed plugins under `{pluginsDir}/.xrk-plugins.json`.
 * `reconcileBoot` regenerates `{pluginsDir}/web/boot.json` from this list.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { PluginKind } from "./classify.js";

export const INVENTORY_FILE = ".xrk-plugins.json";

export interface InventoryEntry {
  readonly name: string;
  readonly version: string;
  readonly kind: PluginKind;
  /** Original add spec (registry / path / github). */
  readonly source: string;
  readonly installedAt: string;
  /** Remapped client inject when kind includes client. */
  readonly clientInject?: readonly string[];
  readonly clientImmediately?: boolean;
}

export interface PluginInventory {
  readonly rev: number;
  readonly packages: Record<string, InventoryEntry>;
}

export interface WebBootEntry {
  readonly id: string;
  readonly url: string;
  readonly rev: string;
  readonly inject: readonly string[];
  readonly immediately?: boolean;
}

export interface WebBootManifest {
  readonly rev: string;
  readonly entries: readonly WebBootEntry[];
}

export function inventoryPath(pluginsDir: string): string {
  return path.join(pluginsDir, INVENTORY_FILE);
}

export function readInventory(pluginsDir: string): PluginInventory {
  const file = inventoryPath(pluginsDir);
  if (!existsSync(file)) {
    return { rev: 1, packages: {} };
  }
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return { rev: 1, packages: {} };
    const o = raw as Record<string, unknown>;
    const packages =
      o.packages && typeof o.packages === "object" && !Array.isArray(o.packages)
        ? (o.packages as Record<string, InventoryEntry>)
        : {};
    return {
      rev: typeof o.rev === "number" ? o.rev : 1,
      packages,
    };
  } catch {
    return { rev: 1, packages: {} };
  }
}

export function writeInventory(
  pluginsDir: string,
  inventory: PluginInventory,
): void {
  mkdirSync(pluginsDir, { recursive: true });
  writeFileSync(
    inventoryPath(pluginsDir),
    `${JSON.stringify(inventory, null, 2)}\n`,
    "utf8",
  );
}

export function upsertInventoryEntry(
  pluginsDir: string,
  entry: InventoryEntry,
): PluginInventory {
  const inv = readInventory(pluginsDir);
  const next: PluginInventory = {
    rev: inv.rev,
    packages: { ...inv.packages, [entry.name]: entry },
  };
  writeInventory(pluginsDir, next);
  return next;
}

export function removeInventoryEntry(
  pluginsDir: string,
  name: string,
): PluginInventory {
  const inv = readInventory(pluginsDir);
  if (!(name in inv.packages)) {
    throw new Error(`plugin not installed: ${name}`);
  }
  const packages = { ...inv.packages };
  delete packages[name];
  const next: PluginInventory = { rev: inv.rev, packages };
  writeInventory(pluginsDir, next);
  return next;
}

/** Absolute install dir for a process plugin package name. */
export function processInstallDir(pluginsDir: string, name: string): string {
  if (name.startsWith("@")) {
    const [scope, pkg] = name.split("/");
    if (!scope || !pkg) {
      throw new Error(`invalid scoped package name: ${name}`);
    }
    return path.join(pluginsDir, scope, pkg);
  }
  return path.join(pluginsDir, name);
}

/** Absolute dir for staged client.js. */
export function clientInstallDir(pluginsDir: string, name: string): string {
  return path.join(pluginsDir, "web", "plugins", ...name.split("/"));
}

/**
 * Rewrite `web/boot.json` from inventory client entries only.
 */
export function reconcileBoot(pluginsDir: string): WebBootManifest {
  const inv = readInventory(pluginsDir);
  const entries: WebBootEntry[] = [];
  for (const entry of Object.values(inv.packages)) {
    if (entry.kind !== "client" && entry.kind !== "both") continue;
    entries.push({
      id: entry.name,
      url: `/plugins/${entry.name}/client.js`,
      rev: entry.version,
      inject: entry.clientInject ?? [],
      ...(entry.clientImmediately ? { immediately: true } : {}),
    });
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  const manifest: WebBootManifest = {
    rev: `xrk-plugins-${Date.now()}`,
    entries,
  };
  const webDir = path.join(pluginsDir, "web");
  mkdirSync(webDir, { recursive: true });
  const bootPath = path.join(webDir, "boot.json");
  if (entries.length === 0) {
    if (existsSync(bootPath)) rmSync(bootPath, { force: true });
    return manifest;
  }
  writeFileSync(bootPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}
