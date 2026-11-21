/**
 * Face plugin inventory: process plugins + product-shell boot entries.
 * User-installed packages (`~/.xrk/plugins/.xrk-plugins.json`) are marked
 * `managed` so the Settings inventory can pin them and offer remove/disable.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { ToolDefinition } from "@xrkseek/core-tools";
import {
  ensureOptionalDefaultsSeededAt,
  isPluginSoftDisabledAt,
  OPTIONAL_OFF_BY_DEFAULT_PLUGIN_IDS,
  readDisabledPluginIdsAt,
  readManagedPackageIndexAt,
  readManagedPluginPackagesAt,
  setSoftDisabledAt,
  writeDisabledPluginIdsAt,
} from "@xrkseek/server-loader";
import { isSafePluginPackageName } from "@xrkseek/server-http";
import { resolveCordisFiberState, hasStagedCordisClient } from "./cordis-bridge.js";
import type { FaceRuntime } from "./context.js";
import { reconcileClientBootAt } from "./plugin-boot.js";
import { mcpAllowFromLayers } from "./mcp-allow.js";
import { resolveHarnessHome } from "./settings-document.js";

/** Re-export install-name hygiene (single source: server-http plugin-package-id). */
export { isSafePluginPackageName };

/** Lightweight MCP desired rows for inventory (avoids settings-credentials cycle). */
function mcpDesiredRowsOf(
  runtime: { readonly settingsNamespaces?: FaceRuntime["settingsNamespaces"] },
): readonly { readonly serverName: string; readonly enabled?: boolean }[] {
  try {
    const namespaces = runtime.settingsNamespaces;
    if (!namespaces) return [];
    const user = namespaces.ensure("mcp").user as {
      servers?: unknown;
    };
    const raw = user.servers;
    if (!Array.isArray(raw)) return [];
    const out: { serverName: string; enabled?: boolean }[] = [];
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const name = String(
        (row as { serverName?: unknown }).serverName ?? "",
      ).trim();
      if (!name) continue;
      const enabled = (row as { enabled?: unknown }).enabled;
      out.push(
        enabled === false
          ? { serverName: name, enabled: false }
          : { serverName: name },
      );
    }
    return out;
  } catch {
    return [];
  }
}

function mcpMasterOnOf(
  runtime: { readonly settingsNamespaces?: FaceRuntime["settingsNamespaces"] },
): boolean {
  try {
    const namespaces = runtime.settingsNamespaces;
    if (!namespaces) return false;
    return mcpAllowFromLayers(namespaces.ensure("mcp"));
  } catch {
    return false;
  }
}

/** Map Host MCP supervisor health onto inventory fiber phases. */
function mcpFiberFromHealth(
  health: FaceProcessPlugin["mcpHealth"],
): FacePluginFiberPhase {
  if (health === "gave-up") return "failed";
  if (health === "reconnecting") return "loading";
  return "active";
}

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
   * User-installed (CLI inventory / community cordis / MCP desired rows) —
   * Settings may offer disable. Built-in product-shell rows stay false.
   * MCP rows are managed for the enable switch only (no folder remove).
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
   * Never set for MCP rows (file-sourced remount is live).
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
 * Phone guest engine rows (`PhoneGuest` writes `source: "phone-guest"`).
 * Not user-managed — Settings must not offer toggle / remove / update.
 */
export function isPhoneGuestEnginePlugin(
  source: string | undefined,
  entryId?: string,
): boolean {
  const s = source?.trim().toLowerCase();
  if (s === "phone-guest") return true;
  const id = entryId?.trim() ?? "";
  return id === "xrk-mobile" || id.startsWith("xrk-mobile-");
}

/** Install-origin class for update checks / menu filtering. */
export type ManagedPluginSourceClass =
  | "engine"
  | "local"
  | "registry"
  | "vcs";

/**
 * Classify a managed inventory `source` for Settings update UX.
 * - engine: phone-guest / xrk-mobile*
 * - local: empty, file:/link:, absolute/relative path
 * - vcs: github: / git+ / http(s):
 * - registry: bare package or name@version pin
 */
export function classifyManagedPluginSource(
  source: string | undefined,
  entryId?: string,
): ManagedPluginSourceClass {
  if (isPhoneGuestEnginePlugin(source, entryId)) return "engine";
  const s = source?.trim();
  if (!s) return "local";
  if (/^(file:|link:)/i.test(s)) return "local";
  if (path.isAbsolute(s) || s.startsWith(".")) return "local";
  if (
    !s.startsWith("@") &&
    !s.includes("@") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(s) &&
    /[/\\]/.test(s)
  ) {
    return "local";
  }
  if (/^(github:|git\+|https?:)/i.test(s)) return "vcs";
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return "vcs";
  return "registry";
}

/**
 * Registry package name for `npm view` (strips `@version` pin).
 * Returns undefined when the source is not a registry install.
 */
export function registryPackageNameFromSource(
  source: string | undefined,
  entryId?: string,
): string | undefined {
  if (classifyManagedPluginSource(source, entryId) !== "registry") {
    return undefined;
  }
  const s = source?.trim();
  let name: string | undefined;
  if (!s) {
    name = entryId?.trim() || undefined;
  } else {
    const pinned = /^((?:@[^/\s]+\/)?[^@\s]+)@([^@\s]+)$/.exec(s);
    name = pinned?.[1] ?? s;
  }
  if (!name || !isSafePluginPackageName(name)) return undefined;
  return name;
}

/**
 * Reinstall/update spec for Settings 「更新」.
 * - Local / file / link / relative paths are cwd-sensitive → `name@latest`.
 * - Registry pins (`name@1.2.3`) must bump → `name@latest` (reinstalling the
 *   same pin is not an update).
 * - github: / other schemes keep the recorded source.
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
  // Registry pin `name@1.2.3` / `@scope/name@1.2.3` → bump to @latest.
  // Leave github:/git+/http(s): recorded sources alone.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    const pinned = /^((?:@[^/\s]+\/)?[^@\s]+)@([^@\s]+)$/.exec(s);
    if (pinned?.[1] !== undefined && pinned[2] !== undefined && /^\d/.test(pinned[2])) {
      return `${pinned[1]}@latest`;
    }
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
  const root = path.resolve(pluginsDirOf(runtime));
  const names = [entryId, moduleName ?? ""]
    .map((n) => n.trim())
    .filter((n) => n.length > 0 && isSafePluginPackageName(n));
  for (const name of names) {
    // Client halves stage under web/plugins/<name>; process plugins may sit at
    // the inventory root. Prefer the staged client layout (what Settings opens).
    const parts = name.startsWith("@") ? name.split("/") : [name];
    const candidates = [
      path.resolve(root, "web", "plugins", ...parts),
      path.resolve(root, ...parts),
      path.resolve(root, name),
    ];
    for (const candidate of candidates) {
      if (candidate !== root && !candidate.startsWith(root + path.sep)) {
        continue;
      }
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
  packages: ReadonlyMap<string, FaceManagedPluginMeta>,
): boolean {
  if (plugin.id.startsWith("mcp:")) return false;
  const meta = packages.get(plugin.id);
  if (isPhoneGuestEnginePlugin(meta?.source, plugin.id)) return false;
  // Product optionals (Settings toggle) stay managed even when Host-gated and
  // not listed in CLI inventory — otherwise soft-disable cannot clear a live half.
  if (OPTIONAL_OFF_BY_DEFAULT_PLUGIN_IDS.includes(plugin.id)) return true;
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
  > & {
    readonly settingsNamespaces?: FaceRuntime["settingsNamespaces"];
  },
): FacePluginInventoryEntry[] {
  const seen = new Set<string>();
  const liveIds = new Set<string>();
  const entries: FacePluginInventoryEntry[] = [];
  const pluginsRoot = pluginsDirOf(runtime);
  ensureOptionalDefaultsSeededAt(pluginsRoot);
  const packages = readUserPluginPackages(runtime);
  const userNames = new Set(packages.keys());
  const disabled = readDisabledPluginIds(runtime);
  const packageIndex = readManagedPackageIndexAt(pluginsRoot);
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

  const mcpDesired = mcpDesiredRowsOf(runtime);
  const mcpDesiredById = new Map<
    string,
    { readonly serverName: string; readonly enabled?: boolean }
  >(mcpDesired.map((row) => [`mcp:${row.serverName}`, row]));
  const mcpMasterOn = mcpMasterOnOf(runtime);

  for (const plugin of runtime.plugins ?? []) {
    const cordis = plugin.kind === "cordis";
    const isMcp = plugin.id.startsWith("mcp:");
    const fiber = cordis
      ? resolveCordisFiberState(runtime, plugin.id)
      : { enabled: true, fiberPhase: "active" as const };
    const managed =
      isMcp || isManagedProcessPlugin(plugin, userNames, runtime, packages);
    const softDisabled = !isMcp && managed && softDisabledOf(plugin.id);
    const mcpRow = isMcp ? mcpDesiredById.get(plugin.id) : undefined;
    // Inventory switch = desired per-server on; master off still keeps desired.
    const mcpDesiredOn = isMcp
      ? mcpRow === undefined || mcpRow.enabled !== false
      : true;
    const mcpLive =
      isMcp && mcpMasterOn && mcpDesiredOn && fiber.enabled;
    const meta = metaOf(plugin.id);
    const kind =
      meta.kind ??
      (isMcp ? "mcp" : cordis ? "cordis" : "process");
    const mcpPhase: FacePluginFiberPhase = isMcp
      ? mcpLive
        ? mcpFiberFromHealth(plugin.mcpHealth)
        : mcpMasterOn && mcpDesiredOn
          ? "loading"
          : null
      : fiber.fiberPhase;
    push(
      {
        entryId: plugin.id,
        moduleName: plugin.id,
        enabled: softDisabled
          ? false
          : isMcp
            ? mcpDesiredOn
            : fiber.enabled,
        fiberPhase: softDisabled ? null : isMcp ? mcpPhase : fiber.fiberPhase,
        managed,
        ...(meta.version ? { version: meta.version } : {}),
        kind,
        ...(meta.source ? { source: meta.source } : {}),
      },
      { live: true },
    );
  }
  for (const web of runtime.webPlugins ?? []) {
    const meta =
      packages.get(web.id) ?? packages.get(web.moduleName ?? "") ?? {};
    const managed =
      !isPhoneGuestEnginePlugin(meta.source, web.id) &&
      (userNames.has(web.id) || userNames.has(web.moduleName ?? ""));
    const softDisabled =
      managed && softDisabledOf(web.id, web.moduleName ?? "");
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
    const engine = isPhoneGuestEnginePlugin(meta.source, name);
    const softDisabled = !engine && softDisabledOf(name);
    push({
      entryId: name,
      moduleName: name,
      enabled: !softDisabled,
      fiberPhase: null,
      managed: !engine,
      ...(meta.version ? { version: meta.version } : {}),
      kind: meta.kind ?? "client",
      ...(meta.source ? { source: meta.source } : {}),
    });
  }

  // Product optional bundles (default off) always appear for the Plugins
  // config card. List them as runtime (managed: false) — the Settings card
  // owns the switch; Plugin list must not show a second toggle.
  for (const id of OPTIONAL_OFF_BY_DEFAULT_PLUGIN_IDS) {
    if (seen.has(id)) continue;
    const softDisabled = softDisabledOf(id);
    push({
      entryId: id,
      moduleName: id,
      enabled: !softDisabled,
      fiberPhase: softDisabled ? null : "active",
      managed: false,
      kind: "process",
    });
  }

  // Desired MCP rows that are soft-off or master-off still need a list row
  // so Settings can re-enable without re-pasting the card.
  for (const row of mcpDesired) {
    const id = `mcp:${row.serverName}`;
    if (seen.has(id)) continue;
    const desiredOn = row.enabled !== false;
    // Master on + desired on but not yet in Host plugins → connecting (not restart).
    const fiberPhase: FacePluginFiberPhase =
      desiredOn && mcpMasterOn ? "loading" : null;
    push({
      entryId: id,
      moduleName: id,
      enabled: desiredOn,
      fiberPhase,
      managed: true,
      kind: "mcp",
    });
  }

  // Desired MCP rows that are soft-off or master-off still need a list row
  // so Settings can re-enable without re-pasting the card.
  for (const row of mcpDesired) {
    const id = `mcp:${row.serverName}`;
    if (seen.has(id)) continue;
    const desiredOn = row.enabled !== false;
    // Master on + desired on but not yet in Host plugins → connecting (not restart).
    const fiberPhase: FacePluginFiberPhase =
      desiredOn && mcpMasterOn ? "loading" : null;
    push({
      entryId: id,
      moduleName: id,
      enabled: desiredOn,
      fiberPhase,
      managed: true,
      kind: "mcp",
    });
  }

  for (let i = 0; i < entries.length; i++) {
    let entry = entries[i]!;
    // Product optionals (git-worktrees): always surface under Built-in / runtime
    // even when a live Host half was classified managed for soft-disable.
    // The Plugins config card owns enable; list must not show a second switch.
    const productOptional = OPTIONAL_OFF_BY_DEFAULT_PLUGIN_IDS.includes(
      entry.entryId,
    );
    if (productOptional && entry.managed) {
      entry = { ...entry, managed: false };
      entries[i] = entry;
    }
    // needsRestart still tracks a live Host half that disagrees with soft-disable
    // (product optionals included when live).
    if (!productOptional && !entry.managed) continue;
    // MCP connect/disconnect is pure hot remount (ensureMcpLiveIfIdle /
    // reconcile). "Not live yet" means connecting / parked / failed — never
    // "restart Host". Skip sticky needsRestart for mcp:* entirely.
    if (entry.kind === "mcp" || entry.entryId.startsWith("mcp:")) continue;
    const live = liveIds.has(entry.entryId);
    // Without a loaded process half, restart cannot materialize the row.
    if (productOptional && !live) continue;
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

/** Soft-disable / re-enable a managed inventory entry (not MCP — use async helper). */
export function setFacePluginInventoryEnabled(
  runtime: Pick<
    FaceRuntime,
    "plugins" | "webPlugins" | "hostPublic" | "productDir"
  > & {
    readonly settingsNamespaces?: FaceRuntime["settingsNamespaces"];
  },
  entryId: string,
  enabled: boolean,
): { ok: true } | { ok: false; error: string } {
  if (entryId.startsWith("mcp:")) {
    return {
      ok: false,
      error: "mcp toggles use setFaceMcpServerEnabled",
    };
  }
  const entry = listFacePluginInventory(runtime).find((e) => e.entryId === entryId);
  if (!entry) return { ok: false, error: "plugin not found" };
  // Product optionals list as runtime (managed: false) but the Plugins config
  // card still soft-disables them via this path.
  if (!entry.managed && !isOptionalProductBundle(entryId)) {
    return { ok: false, error: "builtin plugins cannot be toggled here" };
  }
  // Durable key = CLI inventory package name; aliases stripped on write.
  setSoftDisabledAt(pluginsDirOf(runtime), {
    enabled,
    entryId: entry.entryId,
    aliases: [entry.moduleName],
  });
  reconcileManagedClientBoot(runtime);
  return { ok: true };
}

/** Product optional bundles cannot be removed — only enabled / disabled. */
export function isOptionalProductBundle(entryId: string): boolean {
  return OPTIONAL_OFF_BY_DEFAULT_PLUGIN_IDS.includes(entryId.trim());
}
