/**
 * High-level plugin install / remove / list for `xrkh plugin`.
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { defaultPluginsDir } from "@xrkseek/server-config";
import { classifyPackage } from "./classify.js";
import { fetchPackage } from "./fetch-pack.js";
import {
  installClientBundle,
  removeClientBundle,
} from "./install-client.js";
import {
  installProcessPlugin,
  removeProcessPlugin,
} from "./install-process.js";
import {
  readInventory,
  reconcileBoot,
  removeInventoryEntry,
  upsertInventoryEntry,
  type InventoryEntry,
} from "./inventory.js";
import { remapInjectList } from "./remap-inject.js";
import { reconcileClientStaging } from "./staging-reconcile.js";

export { anchorPathSpec, fetchPackage } from "./fetch-pack.js";
export { classifyPackage } from "./classify.js";
export { remapInjectId, remapInjectList } from "./remap-inject.js";
export {
  readInventory,
  reconcileBoot,
  type InventoryEntry,
  type PluginInventory,
} from "./inventory.js";
export { listStagedClientPluginIds, reconcileClientStaging } from "./staging-reconcile.js";

export interface PluginIo {
  readonly log: (line: string) => void;
  readonly warn: (line: string) => void;
}

const defaultIo: PluginIo = {
  log: (line) => {
    process.stdout.write(`${line}\n`);
  },
  warn: (line) => {
    process.stderr.write(`${line}\n`);
  },
};

function expandPath(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.resolve(homedir(), p.slice(2));
  }
  return path.resolve(p);
}

/** Resolve plugins root: `XRK_PLUGINS_DIR` or `{XRK_HOME}/plugins`. */
export function resolvePluginsDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.XRK_PLUGINS_DIR?.trim();
  if (override) return expandPath(override);
  return defaultPluginsDir(env);
}

export function addPlugin(
  spec: string,
  options: {
    readonly pluginsDir?: string;
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly io?: PluginIo;
  } = {},
): InventoryEntry {
  const io = options.io ?? defaultIo;
  const env = options.env ?? process.env;
  const pluginsDir = options.pluginsDir ?? resolvePluginsDir(env);
  const cwd = options.cwd ?? process.cwd();
  mkdirSync(pluginsDir, { recursive: true });

  const unpacked = fetchPackage(spec, cwd);
  try {
    const classified = classifyPackage(unpacked.root, unpacked.pkg);
    const { inject, dropped } = remapInjectList(classified.clientInject);
    for (const d of dropped) {
      io.warn(
        `xrkh: warning: dropped unknown inject ${JSON.stringify(d)}`,
      );
    }

    if (classified.kind === "client" || classified.kind === "both") {
      installClientBundle(pluginsDir, classified);
    }
    if (classified.kind === "process" || classified.kind === "both") {
      installProcessPlugin(pluginsDir, classified);
    }

    const entry: InventoryEntry = {
      name: classified.name,
      version: classified.version,
      kind: classified.kind,
      source: spec,
      installedAt: new Date().toISOString(),
      ...(classified.kind === "client" || classified.kind === "both"
        ? {
            clientInject: inject,
            ...(classified.clientImmediately
              ? { clientImmediately: true }
              : {}),
          }
        : {}),
    };
    upsertInventoryEntry(pluginsDir, entry);
    reconcilePluginsDir(pluginsDir, io);
    io.log(
      `xrkh: installed ${entry.name}@${entry.version} (${entry.kind}) → ${pluginsDir}`,
    );
    return entry;
  } finally {
    unpacked.cleanup();
  }
}

export function removePlugin(
  name: string,
  options: {
    readonly pluginsDir?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly io?: PluginIo;
  } = {},
): void {
  const io = options.io ?? defaultIo;
  const env = options.env ?? process.env;
  const pluginsDir = options.pluginsDir ?? resolvePluginsDir(env);
  const inv = readInventory(pluginsDir);
  const entry = inv.packages[name];
  if (!entry) {
    throw new Error(`plugin not installed: ${name}`);
  }
  if (entry.kind === "client" || entry.kind === "both") {
    removeClientBundle(pluginsDir, name);
  }
  if (entry.kind === "process" || entry.kind === "both") {
    removeProcessPlugin(pluginsDir, name);
  }
  removeInventoryEntry(pluginsDir, name);
  reconcilePluginsDir(pluginsDir, io);
  io.log(`xrkh: removed ${name}`);
}

/** Sync client staging + `web/boot.json` with inventory (orphan-safe). */
export function reconcilePluginsDir(
  pluginsDir: string,
  io: PluginIo = defaultIo,
): void {
  const removed = reconcileClientStaging(pluginsDir);
  for (const id of removed) {
    io.log(`xrkh: pruned orphan client staging ${id}`);
  }
  reconcileBoot(pluginsDir);
}

export function listPlugins(
  options: {
    readonly pluginsDir?: string;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): readonly InventoryEntry[] {
  const env = options.env ?? process.env;
  const pluginsDir = options.pluginsDir ?? resolvePluginsDir(env);
  const inv = readInventory(pluginsDir);
  return Object.values(inv.packages).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}
