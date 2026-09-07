/**
 * Face plugin inventory: process plugins + product-shell boot entries.
 * User-installed packages (`~/.xrk/plugins/.xrk-plugins.json`) are marked
 * `managed` so the Settings inventory can pin them and offer remove/disable.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { ToolDefinition } from "@xrkseek/core-tools";
import { resolveCordisFiberState } from "./cordis-bridge.js";
import type { FaceRuntime } from "./context.js";
import { resolveHarnessHome } from "./settings-document.js";

/** DSH `pluginInventory/list` fiber phase. */
export type FacePluginFiberPhase =
  | "pending"
  | "loading"
  | "active"
  | "failed"
  | "unloading"
  | null;

export interface FacePluginInventoryEntry {
  readonly entryId: string;
  readonly moduleName: string;
  readonly enabled: boolean;
  readonly fiberPhase: FacePluginFiberPhase;
  /**
   * User-installed (CLI inventory / community cordis) — Settings may offer
   * edit / disable / delete. Built-in product-shell and MCP rows stay false.
   */
  readonly managed: boolean;
}

export interface FaceWebPlugin {
  readonly id: string;
  readonly moduleName?: string;
}

export interface FacePluginCommandResult {
  readonly kind: "success" | "error";
  readonly text?: string;
}

export interface FacePluginCommand {
  readonly name: string;
  readonly description: string;
  readonly input?: { readonly hint: string };
  readonly handler: (ctx: {
    sessionId: string;
    rawInput: string;
    commandId: string;
  }) => FacePluginCommandResult | Promise<FacePluginCommandResult>;
}

/** Process plugin snapshot Face reads for inventory + slash. */
export interface FaceProcessPlugin {
  readonly id: string;
  readonly kind: string;
  readonly commands?: readonly FacePluginCommand[];
  /** `kind: tools` contributions — Face `viewFor` standing lookup. */
  readonly tools?: readonly ToolDefinition[];
  /** `kind: channel` IM / notification descriptors (process plugin discover). */
  readonly channels?: readonly {
    readonly channelId: string;
    readonly displayName?: string;
  }[];
  /** MCP supervisor health (Host `mcp:*` plugins). */
  readonly mcpHealth?: "connected" | "reconnecting" | "gave-up";
}

function pluginsDirOf(runtime: Pick<FaceRuntime, "productDir">): string {
  return path.join(resolveHarnessHome(runtime as FaceRuntime), "plugins");
}

/** Package names recorded by `xrk-harness plugin add`. */
export function readUserPluginNames(
  runtime: Pick<FaceRuntime, "productDir">,
): Set<string> {
  const invPath = path.join(pluginsDirOf(runtime), ".xrk-plugins.json");
  const names = new Set<string>();
  if (!existsSync(invPath)) return names;
  try {
    const raw = JSON.parse(readFileSync(invPath, "utf8")) as {
      packages?: Record<string, unknown>;
    };
    for (const name of Object.keys(raw.packages ?? {})) {
      if (name.trim()) names.add(name.trim());
    }
  } catch {
    /* empty */
  }
  return names;
}

function disabledListPath(pluginsDir: string): string {
  return path.join(pluginsDir, ".xrk-plugins-disabled.json");
}

/** Soft-disabled managed plugin ids under a plugins directory. */
export function readDisabledPluginIdsAt(pluginsDir: string): Set<string> {
  const file = disabledListPath(pluginsDir);
  const out = new Set<string>();
  if (!existsSync(file)) return out;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { ids?: unknown };
    if (!Array.isArray(raw.ids)) return out;
    for (const id of raw.ids) {
      if (typeof id === "string" && id.trim()) out.add(id.trim());
    }
  } catch {
    /* empty */
  }
  return out;
}

/** Soft-disabled managed plugin ids (Settings inventory toggle). */
export function readDisabledPluginIds(
  runtime: Pick<FaceRuntime, "productDir">,
): Set<string> {
  return readDisabledPluginIdsAt(pluginsDirOf(runtime));
}

export function writeDisabledPluginIds(
  runtime: Pick<FaceRuntime, "productDir">,
  ids: ReadonlySet<string>,
): void {
  const dir = pluginsDirOf(runtime);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    disabledListPath(dir),
    `${JSON.stringify({ ids: [...ids].sort() }, null, 2)}\n`,
    "utf8",
  );
}

/** Absolute install directory for a managed plugin, if it exists on disk. */
export function resolveManagedPluginDir(
  runtime: Pick<FaceRuntime, "productDir">,
  entryId: string,
  moduleName?: string,
): string | undefined {
  const root = pluginsDirOf(runtime);
  const names = [entryId, moduleName ?? ""].map((n) => n.trim()).filter(Boolean);
  for (const name of names) {
    // Client halves stage under web/plugins/<name>; process plugins may sit at
    // the inventory root. Prefer the staged client layout (what Settings opens).
    const candidates = [
      path.join(root, "web", "plugins", ...name.split("/")),
      path.join(root, ...name.split("/")),
      path.join(root, name),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * Rewrite `{pluginsDir}/web/boot.json` from inventory client rows, omitting
 * soft-disabled ids so the next Host start does not load them.
 */
export function reconcileManagedClientBoot(
  runtime: Pick<FaceRuntime, "productDir">,
): void {
  const root = pluginsDirOf(runtime);
  const invPath = path.join(root, ".xrk-plugins.json");
  const disabled = readDisabledPluginIdsAt(root);
  const entries: {
    id: string;
    url: string;
    rev: string;
    inject: readonly string[];
    immediately?: boolean;
  }[] = [];
  if (existsSync(invPath)) {
    try {
      const raw = JSON.parse(readFileSync(invPath, "utf8")) as {
        packages?: Record<
          string,
          {
            name?: string;
            version?: string;
            kind?: string;
            clientInject?: readonly string[];
            clientImmediately?: boolean;
          }
        >;
      };
      for (const entry of Object.values(raw.packages ?? {})) {
        const name = entry.name?.trim();
        if (!name) continue;
        if (entry.kind !== "client" && entry.kind !== "both") continue;
        if (disabled.has(name)) continue;
        entries.push({
          id: name,
          url: `/plugins/${name}/client.js`,
          rev: typeof entry.version === "string" ? entry.version : "0",
          inject: entry.clientInject ?? [],
          ...(entry.clientImmediately ? { immediately: true } : {}),
        });
      }
    } catch {
      /* leave entries empty → drop stale boot.json */
    }
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  const webDir = path.join(root, "web");
  mkdirSync(webDir, { recursive: true });
  const bootPath = path.join(webDir, "boot.json");
  if (entries.length === 0) {
    if (existsSync(bootPath)) rmSync(bootPath, { force: true });
    return;
  }
  writeFileSync(
    bootPath,
    `${JSON.stringify({ rev: `xrk-plugins-${Date.now()}`, entries }, null, 2)}\n`,
    "utf8",
  );
}

function isManagedProcessPlugin(
  plugin: FaceProcessPlugin,
  userNames: ReadonlySet<string>,
): boolean {
  if (plugin.id.startsWith("mcp:")) return false;
  if (userNames.has(plugin.id)) return true;
  // Cordis community packages are user-installed; product-shell rows are not.
  if (plugin.kind === "cordis") return true;
  return false;
}

/**
 * Host process plugins first (user-managed sorted ahead), then product-shell
 * boot entries. Cordis uses dsh-compat host.mjs apply or staged `client.js`.
 */
export function listFacePluginInventory(
  runtime: Pick<
    FaceRuntime,
    "plugins" | "webPlugins" | "hostPublic" | "productDir"
  >,
): FacePluginInventoryEntry[] {
  const seen = new Set<string>();
  const entries: FacePluginInventoryEntry[] = [];
  const userNames = readUserPluginNames(runtime);
  const disabled = readDisabledPluginIds(runtime);
  const push = (entry: FacePluginInventoryEntry) => {
    if (seen.has(entry.entryId)) return;
    seen.add(entry.entryId);
    entries.push(entry);
  };

  for (const plugin of runtime.plugins ?? []) {
    const cordis = plugin.kind === "cordis";
    const fiber = cordis
      ? resolveCordisFiberState(runtime, plugin.id)
      : { enabled: true, fiberPhase: "active" as const };
    const managed = isManagedProcessPlugin(plugin, userNames);
    const softDisabled = managed && disabled.has(plugin.id);
    push({
      entryId: plugin.id,
      moduleName: plugin.id,
      enabled: softDisabled ? false : fiber.enabled,
      fiberPhase: softDisabled ? null : fiber.fiberPhase,
      managed,
    });
  }
  for (const web of runtime.webPlugins ?? []) {
    const managed =
      userNames.has(web.id) || userNames.has(web.moduleName ?? "");
    const softDisabled = managed && disabled.has(web.id);
    push({
      entryId: web.id,
      moduleName: web.moduleName ?? web.id,
      enabled: softDisabled ? false : true,
      fiberPhase: softDisabled ? null : "active",
      managed,
    });
  }

  entries.sort((a, b) => {
    if (a.managed !== b.managed) return a.managed ? -1 : 1;
    return a.moduleName.localeCompare(b.moduleName);
  });
  return entries;
}

export function collectFacePluginCommands(
  plugins: readonly FaceProcessPlugin[] | undefined,
): readonly FacePluginCommand[] {
  const seen = new Set<string>();
  const out: FacePluginCommand[] = [];
  for (const plugin of plugins ?? []) {
    if (plugin.kind !== "commands") continue;
    for (const command of plugin.commands ?? []) {
      if (seen.has(command.name)) continue;
      seen.add(command.name);
      out.push(command);
    }
  }
  return out;
}

/** Soft-disable / re-enable a managed inventory entry. */
export function setFacePluginInventoryEnabled(
  runtime: Pick<FaceRuntime, "plugins" | "webPlugins" | "hostPublic" | "productDir">,
  entryId: string,
  enabled: boolean,
): { ok: true } | { ok: false; error: string } {
  const entry = listFacePluginInventory(runtime).find((e) => e.entryId === entryId);
  if (!entry) return { ok: false, error: "plugin not found" };
  if (!entry.managed) return { ok: false, error: "builtin plugins cannot be toggled here" };
  const disabled = readDisabledPluginIds(runtime);
  if (enabled) disabled.delete(entryId);
  else disabled.add(entryId);
  writeDisabledPluginIds(runtime, disabled);
  reconcileManagedClientBoot(runtime);
  return { ok: true };
}
