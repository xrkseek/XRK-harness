/**
 * Face plugin inventory: process plugins + product-shell boot entries.
 * User-installed packages (`~/.xrk/plugins/.xrk-plugins.json`) are marked
 * `managed` so the Settings inventory can pin them and offer remove/disable.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

function disabledListPath(runtime: Pick<FaceRuntime, "productDir">): string {
  return path.join(pluginsDirOf(runtime), ".xrk-plugins-disabled.json");
}

/** Soft-disabled managed plugin ids (Settings inventory toggle). */
export function readDisabledPluginIds(
  runtime: Pick<FaceRuntime, "productDir">,
): Set<string> {
  const file = disabledListPath(runtime);
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

export function writeDisabledPluginIds(
  runtime: Pick<FaceRuntime, "productDir">,
  ids: ReadonlySet<string>,
): void {
  const dir = pluginsDirOf(runtime);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    disabledListPath(runtime),
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
  for (const name of [entryId, moduleName ?? ""]) {
    if (!name.trim()) continue;
    const candidate = path.join(root, name.trim());
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function isManagedProcessPlugin(
  plugin: FaceProcessPlugin,
  userNames: ReadonlySet<string>,
): boolean {
  if (plugin.id.startsWith("mcp:")) return false;
  if (userNames.has(plugin.id)) return true;
  if (plugin.kind === "cordis") return true;
  if (/better-sidebar|xrkh-/i.test(plugin.id)) return true;
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
      userNames.has(web.id) ||
      userNames.has(web.moduleName ?? "") ||
      /better-sidebar|xrkh-/i.test(web.id) ||
      /better-sidebar|xrkh-/i.test(web.moduleName ?? "");
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
  return { ok: true };
}
