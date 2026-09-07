/**
 * Face plugin inventory: process plugins + product-shell boot entries.
 * User-installed packages (`~/.xrk/plugins/.xrk-plugins.json`) are marked
 * `managed` so the Settings inventory can pin them and offer remove/disable.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { ToolDefinition } from "@xrkseek/core-tools";
import {
  isPluginSoftDisabledAt,
  readDisabledPluginIdsAt,
  readManagedPackageIndexAt,
  readManagedPluginPackagesAt,
  setSoftDisabledAt,
  writeDisabledPluginIdsAt,
} from "@xrkseek/server-loader";
import { resolveCordisFiberState, hasStagedCordisClient } from "./cordis-bridge.js";
import type { FaceRuntime } from "./context.js";
import { reconcileClientBootAt } from "./plugin-boot.js";
import { resolveHarnessHome } from "./settings-document.js";

export {
  DISABLED_PLUGINS_FILE,
  clearSoftDisabledIdsAt,
  canonicalizeDisabledPluginIdsAt,
  isPluginSoftDisabledAt,
  lookupManagedPluginSourceAt,
  readDisabledPluginIdsAt,
  readManagedPackageIndexAt,
  readManagedPluginPackagesAt,
  setSoftDisabledAt,
  writeDisabledPluginIdsAt,
} from "./plugin-disabled.js";

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
  /** CLI inventory version when known (Codex-style plugin summary). */
  readonly version?: string;
  /** `client` | `process` | `both` | `mcp` | `cordis` | `builtin`. */
  readonly kind?: string;
  /** Original `plugin add` spec when managed. */
  readonly source?: string;
  /**
   * Soft-disable / re-enable / install changed disk state but this Host
   * process still has the opposite live set — restart to apply.
   */
  readonly needsRestart?: boolean;
}

export interface FaceManagedPluginMeta {
  readonly version?: string;
  readonly kind?: string;
  readonly source?: string;
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

/**
 * Managed plugins root: Host `pluginsDir` (incl. `XRK_PLUGINS_DIR`) wins;
 * otherwise `{harnessHome}/plugins`.
 */
export function resolveManagedPluginsDir(
  runtime: Pick<FaceRuntime, "productDir" | "hostPublic">,
): string {
  const fromHost = runtime.hostPublic?.pluginsDir?.trim();
  if (fromHost) return path.resolve(fromHost);
  return path.join(resolveHarnessHome(runtime as FaceRuntime), "plugins");
}

/** Alias used by inventory helpers in this module. */
function pluginsDirOf(
  runtime: Pick<FaceRuntime, "productDir" | "hostPublic">,
): string {
  return resolveManagedPluginsDir(runtime);
}

/**
 * Reinstall/update spec: keep registry / github sources; local path installs
 * are cwd-sensitive after Host restart → fall back to `name@latest`.
 */
export function resolveManagedPluginUpdateSpec(
  entryId: string,
  source: string | undefined,
): string {
  const id = entryId.trim();
  const s = source?.trim();
  if (!id) return "unknown@latest";
  if (!s) return `${id}@latest`;
  if (/^(file:|link:)/i.test(s)) return `${id}@latest`;
  if (path.isAbsolute(s) || s.startsWith(".")) return `${id}@latest`;
  // Unscoped path-like strings (`ext/pkg`) without a registry/git scheme.
  if (
    !s.startsWith("@") &&
    !s.includes("@") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(s) &&
    /[/\\]/.test(s)
  ) {
    return `${id}@latest`;
  }
  return s;
}

/** Package names recorded by `xrk-harness plugin add`. */
export function readUserPluginNames(
  runtime: Pick<FaceRuntime, "productDir" | "hostPublic">,
): Set<string> {
  return new Set(readUserPluginPackages(runtime).keys());
}

/** CLI inventory rows keyed by package name (version / kind / source). */
export function readUserPluginPackages(
  runtime: Pick<FaceRuntime, "productDir" | "hostPublic">,
): Map<string, FaceManagedPluginMeta> {
  const out = new Map<string, FaceManagedPluginMeta>();
  for (const [name, meta] of readManagedPluginPackagesAt(pluginsDirOf(runtime))) {
    out.set(name, {
      ...(meta.version ? { version: meta.version } : {}),
      ...(meta.kind ? { kind: meta.kind } : {}),
      ...(meta.source ? { source: meta.source } : {}),
    });
  }
  return out;
}

/** Soft-disabled managed plugin ids (Settings inventory toggle). */
export function readDisabledPluginIds(
  runtime: Pick<FaceRuntime, "productDir" | "hostPublic">,
): Set<string> {
  return readDisabledPluginIdsAt(pluginsDirOf(runtime));
}

export function writeDisabledPluginIds(
  runtime: Pick<FaceRuntime, "productDir" | "hostPublic">,
  ids: ReadonlySet<string>,
): void {
  writeDisabledPluginIdsAt(pluginsDirOf(runtime), ids);
}

/** Absolute install directory for a managed plugin, if it exists on disk. */
export function resolveManagedPluginDir(
  runtime: Pick<FaceRuntime, "productDir" | "hostPublic">,
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
 * Rewrite `{pluginsDir}/web/boot.json` from inventory client rows.
 * Delegates to shared {@link reconcileClientBootAt} (stable rev · atomic write).
 */
export function reconcileManagedClientBoot(
  runtime: Pick<FaceRuntime, "productDir" | "hostPublic">,
): void {
  reconcileClientBootAt(pluginsDirOf(runtime));
}

function isManagedProcessPlugin(
  plugin: FaceProcessPlugin,
  userNames: ReadonlySet<string>,
  runtime: Pick<FaceRuntime, "hostPublic">,
): boolean {
  if (plugin.id.startsWith("mcp:")) return false;
  if (userNames.has(plugin.id)) return true;
  // Only staged / inventory community cordis are managed — not product-shell
  // cordis stubs (those must not gain Settings disable/delete).
  if (plugin.kind === "cordis") {
    return hasStagedCordisClient(runtime, plugin.id);
  }
  return false;
}

/**
 * Host process plugins first (user-managed sorted ahead), then product-shell
 * boot entries, then CLI inventory packages missing from live boot.
 *
 * Soft-disabled client packages are dropped from `web/boot.json` (and thus from
 * Host `webPlugins`) so they do not load — but Settings must still list them
 * from `.xrk-plugins.json`, otherwise there is no row to re-enable.
 */
export function listFacePluginInventory(
  runtime: Pick<
    FaceRuntime,
    "plugins" | "webPlugins" | "hostPublic" | "productDir"
  >,
): FacePluginInventoryEntry[] {
  const seen = new Set<string>();
  const liveIds = new Set<string>();
  const entries: FacePluginInventoryEntry[] = [];
  const packages = readUserPluginPackages(runtime);
  const userNames = new Set(packages.keys());
  const disabled = readDisabledPluginIds(runtime);
  const packageIndex = readManagedPackageIndexAt(pluginsDirOf(runtime));
  const softDisabledOf = (...ids: readonly string[]) =>
    ids.some((id) => isPluginSoftDisabledAt(id, disabled, packageIndex));
  const metaOf = (id: string): FaceManagedPluginMeta => packages.get(id) ?? {};
  const push = (
    entry: FacePluginInventoryEntry,
    options: { readonly live?: boolean } = {},
  ) => {
    if (seen.has(entry.entryId)) return;
    seen.add(entry.entryId);
    if (options.live) liveIds.add(entry.entryId);
    entries.push(entry);
  };

  for (const plugin of runtime.plugins ?? []) {
    const cordis = plugin.kind === "cordis";
    const fiber = cordis
      ? resolveCordisFiberState(runtime, plugin.id)
      : { enabled: true, fiberPhase: "active" as const };
    const managed = isManagedProcessPlugin(plugin, userNames, runtime);
    const softDisabled = managed && softDisabledOf(plugin.id);
    const meta = metaOf(plugin.id);
    const kind =
      meta.kind ??
      (plugin.id.startsWith("mcp:")
        ? "mcp"
        : cordis
          ? "cordis"
          : "process");
    push(
      {
        entryId: plugin.id,
        moduleName: plugin.id,
        enabled: softDisabled ? false : fiber.enabled,
        fiberPhase: softDisabled ? null : fiber.fiberPhase,
        managed,
        ...(meta.version ? { version: meta.version } : {}),
        kind,
        ...(meta.source ? { source: meta.source } : {}),
      },
      { live: true },
    );
  }
  for (const web of runtime.webPlugins ?? []) {
    const managed =
      userNames.has(web.id) || userNames.has(web.moduleName ?? "");
    const softDisabled =
      managed && softDisabledOf(web.id, web.moduleName ?? "");
    const meta =
      packages.get(web.id) ?? packages.get(web.moduleName ?? "") ?? {};
    push(
      {
        entryId: web.id,
        moduleName: web.moduleName ?? web.id,
        enabled: softDisabled ? false : true,
        fiberPhase: softDisabled ? null : "active",
        managed,
        ...(meta.version ? { version: meta.version } : {}),
        kind: meta.kind ?? "client",
        ...(meta.source ? { source: meta.source } : {}),
      },
      { live: true },
    );
  }
  // Inventory is the durable source for managed packages. Client-only rows that
  // were soft-disabled (or installed after this Host start) are not in webPlugins.
  for (const [name, meta] of packages) {
    if (seen.has(name)) continue;
    const softDisabled = softDisabledOf(name);
    push({
      entryId: name,
      moduleName: name,
      enabled: !softDisabled,
      fiberPhase: null,
      managed: true,
      ...(meta.version ? { version: meta.version } : {}),
      kind: meta.kind ?? "client",
      ...(meta.source ? { source: meta.source } : {}),
    });
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (!entry.managed) continue;
    const live = liveIds.has(entry.entryId);
    const needsRestart =
      (entry.enabled && !live) || (!entry.enabled && live);
    if (!needsRestart) continue;
    entries[i] = { ...entry, needsRestart: true };
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
  // Durable key = CLI inventory package name; aliases stripped on write.
  setSoftDisabledAt(pluginsDirOf(runtime), {
    enabled,
    entryId: entry.entryId,
    aliases: [entry.moduleName],
  });
  reconcileManagedClientBoot(runtime);
  return { ok: true };
}
