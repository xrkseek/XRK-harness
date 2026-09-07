/**
 * Inventory of CLI-installed plugins under `{pluginsDir}/.xrk-plugins.json`.
 * Soft-disable disk I/O: `@xrkseek/server-loader`; boot reconcile: Face.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  DISABLED_PLUGINS_FILE,
  atomicWriteText,
  clearSoftDisabledIdsAt,
  readDisabledPluginIdsAt,
  writeDisabledPluginIdsAt,
} from "@xrkseek/server-loader";
import { reconcileClientBootAt } from "@xrkseek/server-face";
import type { PluginKind } from "./classify.js";

export const INVENTORY_FILE = ".xrk-plugins.json";
/** @deprecated Prefer loader `DISABLED_PLUGINS_FILE`. */
export const DISABLED_FILE = DISABLED_PLUGINS_FILE;

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

export function disabledPath(pluginsDir: string): string {
  return path.join(pluginsDir, DISABLED_FILE);
}

/** Soft-disabled managed plugin ids (Settings inventory toggle). */
export function readDisabledPluginIds(pluginsDir: string): Set<string> {
  return readDisabledPluginIdsAt(pluginsDir);
}

/** Persist soft-disable list (empty set removes the marker file). */
export function writeDisabledPluginIds(
  pluginsDir: string,
  ids: ReadonlySet<string>,
): void {
  writeDisabledPluginIdsAt(pluginsDir, ids);
}

/**
 * Drop one id (and inventory aliases) from the soft-disable list.
 * Returns true when the on-disk set changed.
 */
export function clearDisabledPluginId(
  pluginsDir: string,
  name: string,
): boolean {
  return clearSoftDisabledIdsAt(pluginsDir, name);
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
  const file = inventoryPath(pluginsDir);
  const body = `${JSON.stringify(inventory, null, 2)}\n`;
  if (existsSync(file)) {
    try {
      if (readFileSync(file, "utf8") === body) return;
    } catch {
      /* rewrite */
    }
  }
  atomicWriteText(file, body);
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
 * Face `reconcileClientBootAt` (stable rev · atomic · canonicalize disabled).
 */
export function reconcileBoot(pluginsDir: string): WebBootManifest {
  const result = reconcileClientBootAt(pluginsDir);
  return {
    rev: result.rev,
    entries: result.entries.map((e) => ({
      id: e.id,
      url: e.url,
      rev: e.rev,
      inject: e.inject,
      ...(e.immediately ? { immediately: true } : {}),
    })),
  };
}
