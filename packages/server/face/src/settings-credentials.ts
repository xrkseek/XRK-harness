/**
 * Face U2 settings + credentials — public settings writable; secrets never logged / never on disk.
 */

import { readFileSync } from "node:fs";
import { access, constants, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FaceRuntime } from "./context.js";
import type { FaceRpcResult } from "./types.js";
import { canOpenNativePath, openNativePath } from "./host-open-path.js";
import { publishRemoteEvent } from "./remote-event.js";
import {
  DSH_EMPTY_OBJECT_SCHEMA,
  DSH_LLM_SCHEMA,
  DSH_LOCALE_SCHEMA,
  DSH_MCP_SCHEMA,
  DSH_ONBOARDING_SCHEMA,
  DSH_PERMISSION_SCHEMA,
  DSH_THEME_SCHEMA,
  isFacePermissionPreset,
} from "./dsh-schema.js";

export type UiTheme = "system" | "light" | "dark";

export interface FaceUiSettings {
  theme: UiTheme;
  locale: string;
}

export interface FaceHostPublicSettings {
  readonly host: string;
  readonly port: number;
  readonly workspaceRoot: string;
  readonly preset: string;
  readonly corsOrigin: string;
  readonly rateLimitPerMinute: number;
  readonly pluginsDir?: string;
  readonly webDistConfigured: boolean;
}

export interface CredentialSlotView {
  readonly id: string;
  readonly label: string;
  readonly envVar?: string;
  /** True if env or in-memory vault has a non-empty value. Never returns the value. */
  readonly configured: boolean;
  readonly source: "env" | "vault" | "none";
}

const UI_THEMES = new Set<UiTheme>(["system", "light", "dark"]);
const MAX_LOCALE = 32;
const MAX_SECRET = 8192;

/** DSH locale plugin only ships `zh` | `en`. */
function dshLocalePreference(locale: string): "zh" | "en" {
  const lower = locale.trim().toLowerCase();
  return lower.startsWith("zh") ? "zh" : "en";
}

const LOCALE_SCHEMA = DSH_LOCALE_SCHEMA;
const THEME_SCHEMA = DSH_THEME_SCHEMA;

function applyDshUiPref(
  runtime: FaceRuntime,
  ns: string,
  value: Record<string, unknown>,
): void {
  if (ns === "ui") {
    if (typeof value.theme === "string" && UI_THEMES.has(value.theme as UiTheme)) {
      runtime.uiSettings.theme = value.theme as UiTheme;
    }
    if (typeof value.locale === "string" && value.locale.trim()) {
      runtime.uiSettings.locale = value.locale.trim().slice(0, MAX_LOCALE);
    }
  }
  if (ns === "ui-theme") {
    const pref = value.preference;
    if (typeof pref === "string" && UI_THEMES.has(pref as UiTheme)) {
      runtime.uiSettings.theme = pref as UiTheme;
    }
  }
  if (ns === "locale") {
    const pref = value.preference;
    if (typeof pref === "string" && pref.trim()) {
      runtime.uiSettings.locale = pref.trim().slice(0, MAX_LOCALE);
    }
  }
}

export function defaultUiSettings(): FaceUiSettings {
  return { theme: "system", locale: "en" };
}

export class FaceCredentialVault {
  private readonly overrides = new Map<string, string>();

  peek(slotId: string): string | undefined {
    const v = this.overrides.get(slotId);
    return v !== undefined && v.length > 0 ? v : undefined;
  }

  hasOverride(slotId: string): boolean {
    return this.peek(slotId) !== undefined;
  }

  set(slotId: string, value: string | null): void {
    if (value === null || value === "") {
      this.overrides.delete(slotId);
      return;
    }
    this.overrides.set(slotId, value);
  }

  /** Test / diagnostics — never expose via Face RPC. */
  size(): number {
    return this.overrides.size;
  }
}

function envHas(env: NodeJS.ProcessEnv, name: string | undefined): boolean {
  if (!name) return false;
  const v = env[name];
  return typeof v === "string" && v.trim().length > 0;
}

export function listCredentialSlots(
  runtime: FaceRuntime,
  env: NodeJS.ProcessEnv = process.env,
): CredentialSlotView[] {
  const vault = runtime.credentials;
  const slots: CredentialSlotView[] = [];

  const hostEnv = "XRK_API_KEY";
  const hostVault = vault.peek("host.apiKey");
  const hostEnvOk =
    envHas(env, hostEnv) || Boolean(runtime.bootstrapApiKey?.trim());
  slots.push({
    id: "host.apiKey",
    label: "Host API key",
    envVar: hostEnv,
    configured: Boolean(hostVault) || hostEnvOk,
    source: hostVault ? "vault" : hostEnvOk ? "env" : "none",
  });

  for (const brand of runtime.registry.listBrands()) {
    if (!brand.apiKeyEnv) continue;
    const id = `llm.${brand.id}`;
    const v = vault.peek(id);
    const e = envHas(env, brand.apiKeyEnv);
    slots.push({
      id,
      label: `${brand.displayName} API key`,
      envVar: brand.apiKeyEnv,
      configured: Boolean(v) || e,
      source: v ? "vault" : e ? "env" : "none",
    });
  }

  return slots;
}

/** Effective Host API key: vault override wins, else bootstrap env/config value. */
export function effectiveHostApiKey(runtime: FaceRuntime): string {
  return (
    runtime.credentials.peek("host.apiKey") ??
    runtime.bootstrapApiKey ??
    ""
  );
}

export async function settingsGet(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<FaceRpcResult<unknown>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const scope =
    typeof p.scope === "string" && p.scope.trim() ? p.scope.trim() : undefined;

  const ui = { ...runtime.uiSettings };
  const host = runtime.hostPublic;
  const llm = {
    brands: runtime.registry.listBrands().map((b) => ({
      id: b.id,
      displayName: b.displayName,
      defaultModel: b.defaultModel ?? null,
      apiKeyEnv: b.apiKeyEnv ?? null,
    })),
    routable: runtime.registry.listRoutable(),
  };

  const scopes = [
    {
      id: "ui",
      writable: true,
      keys: ["theme", "locale"] as const,
    },
    {
      id: "host",
      writable: false,
      keys: [
        "host",
        "port",
        "workspaceRoot",
        "preset",
        "corsOrigin",
        "rateLimitPerMinute",
        "pluginsDir",
        "webDistConfigured",
      ] as const,
    },
    {
      id: "llm",
      writable: false,
      keys: ["brands", "routable"] as const,
    },
  ];

  const values: Record<string, unknown> = {
    ui,
    ...(host ? { host } : { host: null }),
    llm,
  };

  if (scope) {
    if (!(scope in values) && scope !== "ui" && scope !== "host" && scope !== "llm") {
      return {
        ok: false,
        error: {
          code: "settings-scope-not-found",
          message: `unknown scope: ${scope}`,
        },
      };
    }
    return {
      ok: true,
      value: {
        scopes: scopes.filter((s) => s.id === scope),
        values: { [scope]: values[scope] ?? null },
      },
    };
  }

  return { ok: true, value: { scopes, values } };
}

export async function settingsSet(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<FaceRpcResult<unknown>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const scope = typeof p.scope === "string" ? p.scope.trim() : "";
  const patch =
    p.patch && typeof p.patch === "object"
      ? (p.patch as Record<string, unknown>)
      : undefined;

  if (!scope || !patch) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "scope and patch required",
      },
    };
  }

  if (scope === "host" || scope === "llm") {
    return {
      ok: false,
      error: {
        code: "settings-readonly",
        message: `scope "${scope}" is read-only`,
      },
    };
  }

  if (scope !== "ui") {
    return {
      ok: false,
      error: {
        code: "settings-scope-not-found",
        message: `unknown scope: ${scope}`,
      },
    };
  }

  const next: FaceUiSettings = { ...runtime.uiSettings };
  if ("theme" in patch) {
    const theme = String(patch.theme);
    if (!UI_THEMES.has(theme as UiTheme)) {
      return {
        ok: false,
        error: {
          code: "settings-invalid",
          message: "theme must be system|light|dark",
        },
      };
    }
    next.theme = theme as UiTheme;
  }
  if ("locale" in patch) {
    const locale = String(patch.locale).trim();
    if (!locale || locale.length > MAX_LOCALE) {
      return {
        ok: false,
        error: {
          code: "settings-invalid",
          message: `locale must be 1..${MAX_LOCALE} chars`,
        },
      };
    }
    next.locale = locale;
  }

  runtime.uiSettings.theme = next.theme;
  runtime.uiSettings.locale = next.locale;
  publishRemoteEvent(runtime.bus, "settings/document-updated", [
    "ui-theme",
    runtime.settingsNamespaces.view("ui-theme").revision,
  ]);
  publishRemoteEvent(runtime.bus, "settings/document-updated", [
    "locale",
    runtime.settingsNamespaces.view("locale").revision,
  ]);

  return { ok: true, value: { scope: "ui", values: { ...runtime.uiSettings } } };
}

export async function credentialsList(
  runtime: FaceRuntime,
): Promise<FaceRpcResult<unknown>> {
  return {
    ok: true,
    value: {
      slots: listCredentialSlots(runtime),
      persistence: "memory-or-env",
      note: "Face never returns secret values; vault is process-memory only",
    },
  };
}

function resolveCredentialSlotId(
  runtime: FaceRuntime,
  refOrSlot: string,
): string | undefined {
  const slots = listCredentialSlots(runtime);
  const byId = slots.find((s) => s.id === refOrSlot);
  if (byId) return byId.id;
  const byEnv = slots.find((s) => s.envVar === refOrSlot);
  return byEnv?.id;
}

/** DSH `credentials/updated` uses CredentialRef (env var name when known). */
function emitCredentialRemote(runtime: FaceRuntime, slotId: string): void {
  const slot = listCredentialSlots(runtime).find((s) => s.id === slotId);
  publishRemoteEvent(runtime.bus, "credentials/updated", [
    slot?.envVar ?? slotId,
  ]);
  if (slotId.startsWith("llm.")) {
    publishRemoteEvent(runtime.bus, "llm/adapters-updated", []);
  }
}

/** DeepSeek `credentials.describe({ refs })` — never returns secret values. */
export async function credentialsDescribe(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<FaceRpcResult<unknown>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const refs = Array.isArray(p.refs)
    ? p.refs.filter((x): x is string => typeof x === "string" && x.trim() !== "")
    : [];
  if (refs.length === 0) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "refs string[] required" },
    };
  }
  const credentials: Record<
    string,
    { configured: boolean; source?: string; writable: boolean }
  > = {};
  for (const ref of refs) {
    const slotId = resolveCredentialSlotId(runtime, ref.trim());
    if (!slotId) {
      credentials[ref] = { configured: false, writable: true };
      continue;
    }
    const slot = listCredentialSlots(runtime).find((s) => s.id === slotId)!;
    credentials[ref] = {
      configured: slot.configured,
      ...(slot.source !== "none" ? { source: slot.source } : {}),
      writable: true,
    };
  }
  return { ok: true, value: { credentials } };
}

export async function credentialsSet(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<FaceRpcResult<unknown>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  // DeepSeek: { ref, value } · XRK console: { slotId, value }
  const rawRef =
    typeof p.ref === "string"
      ? p.ref.trim()
      : typeof p.slotId === "string"
        ? p.slotId.trim()
        : "";
  const slotId = rawRef ? resolveCredentialSlotId(runtime, rawRef) : undefined;
  if (!slotId) {
    return {
      ok: false,
      error: {
        code: rawRef ? "credentials-slot-not-found" : "invalid-payload",
        message: rawRef
          ? `unknown credential ref: ${rawRef}`
          : "ref or slotId required",
      },
    };
  }

  const clear = p.clear === true || p.value === null || p.value === "";
  if (clear) {
    runtime.credentials.set(slotId, null);
    emitCredentialRemote(runtime, slotId);
    return {
      ok: true,
      value: {
        slotId,
        configured: listCredentialSlots(runtime).find((s) => s.id === slotId)
          ?.configured,
        source: listCredentialSlots(runtime).find((s) => s.id === slotId)
          ?.source,
        cleared: true,
      },
    };
  }

  if (typeof p.value !== "string") {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "value string required (or clear: true)",
      },
    };
  }
  if (p.value.length > MAX_SECRET) {
    return {
      ok: false,
      error: {
        code: "credentials-too-large",
        message: `value max ${MAX_SECRET} chars`,
      },
    };
  }

  runtime.credentials.set(slotId, p.value);
  const slot = listCredentialSlots(runtime).find((s) => s.id === slotId)!;
  emitCredentialRemote(runtime, slotId);
  return {
    ok: true,
    value: {
      slotId,
      configured: slot.configured,
      source: slot.source,
      cleared: false,
    },
  };
}

/** DeepSeek `credentials.unset({ ref })` → empty object. */
export async function credentialsUnset(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<FaceRpcResult<unknown>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const rawRef =
    typeof p.ref === "string"
      ? p.ref.trim()
      : typeof p.slotId === "string"
        ? p.slotId.trim()
        : "";
  const slotId = rawRef ? resolveCredentialSlotId(runtime, rawRef) : undefined;
  if (!slotId) {
    return {
      ok: false,
      error: {
        code: rawRef ? "credentials-slot-not-found" : "invalid-payload",
        message: rawRef
          ? `unknown credential ref: ${rawRef}`
          : "ref or slotId required",
      },
    };
  }
  runtime.credentials.set(slotId, null);
  emitCredentialRemote(runtime, slotId);
  return { ok: true, value: {} };
}

/** DeepSeek SettingsNamespaceView (minimal fields the web client reads). */
export interface DshSettingsNamespaceView {
  readonly ns: string;
  readonly schema: unknown;
  readonly value: unknown;
  readonly base?: unknown;
  readonly user?: unknown;
  readonly applies: "live" | "restart";
  readonly secrets: readonly { readonly path: string[]; readonly set: boolean }[];
  readonly revision: number;
}

export type DshSettingsPathOp =
  | { readonly op: "set"; readonly path: string[]; readonly value: unknown }
  | { readonly op: "unset"; readonly path: string[] };

function setAtPath(
  root: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): void {
  if (path.length === 0) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const key of Object.keys(root)) delete root[key];
      Object.assign(root, value as Record<string, unknown>);
    }
    return;
  }
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    const next = cur[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[path[path.length - 1]!] = value;
}

function unsetAtPath(
  root: Record<string, unknown>,
  path: readonly string[],
): void {
  if (path.length === 0) {
    for (const key of Object.keys(root)) delete root[key];
    return;
  }
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i++) {
    const next = cur[path[i]!];
    if (!next || typeof next !== "object" || Array.isArray(next)) return;
    cur = next as Record<string, unknown>;
  }
  delete cur[path[path.length - 1]!];
}

/**
 * Process-memory settings namespaces for DeepSeek Web (welcome notice, etc.).
 * Most ns stay in memory; `mcp.servers` also persist to host-settings.json.
 */
export class FaceSettingsNamespaces {
  private readonly map = new Map<
    string,
    {
      user: Record<string, unknown>;
      revision: number;
      base: Record<string, unknown>;
      schema: unknown;
      applies: "live" | "restart";
    }
  >();

  ensure(ns: string): {
    user: Record<string, unknown>;
    revision: number;
    base: Record<string, unknown>;
    schema: unknown;
    applies: "live" | "restart";
  } {
    let slot = this.map.get(ns);
    if (!slot) {
      slot = {
        user: {},
        revision: 0,
        base: {},
        schema: DSH_EMPTY_OBJECT_SCHEMA,
        applies: "live",
      };
      this.map.set(ns, slot);
    }
    return slot;
  }

  view(
    ns: string,
    base?: Record<string, unknown>,
    schema?: unknown,
    applies?: "live" | "restart",
  ): DshSettingsNamespaceView {
    const slot = this.ensure(ns);
    if (base !== undefined) slot.base = base;
    if (schema !== undefined) slot.schema = schema;
    if (applies !== undefined) slot.applies = applies;
    return {
      ns,
      schema: slot.schema,
      value: { ...slot.base, ...slot.user },
      base: { ...slot.base },
      user: { ...slot.user },
      applies: slot.applies,
      secrets: [],
      revision: slot.revision,
    };
  }

  mutate(
    ns: string,
    ops: readonly DshSettingsPathOp[],
    expectedRevision?: number,
  ):
    | { ok: true; view: DshSettingsNamespaceView }
    | { ok: false; code: string; message: string } {
    const slot = this.ensure(ns);
    if (
      expectedRevision !== undefined &&
      expectedRevision !== slot.revision
    ) {
      return {
        ok: false,
        code: "settings-conflict",
        message: "expectedRevision mismatch",
      };
    }
    const nextUser = { ...slot.user };
    for (const op of ops) {
      if (op.op === "set") setAtPath(nextUser, op.path, op.value);
      else unsetAtPath(nextUser, op.path);
    }
    const merged = { ...slot.base, ...nextUser };
    const invalid = validateNamespaceValue(ns, merged);
    if (invalid) {
      return { ok: false, code: "settings-invalid", message: invalid };
    }
    slot.user = nextUser;
    slot.revision += 1;
    return { ok: true, view: this.view(ns) };
  }
}

function validateNamespaceValue(
  ns: string,
  value: Record<string, unknown>,
): string | undefined {
  if (ns === "permission") {
    const preset = value.defaultPreset;
    if (preset !== undefined && !isFacePermissionPreset(preset)) {
      return `unknown permission preset: ${String(preset)}`;
    }
  }
  if (ns === "ui-theme") {
    const pref = value.preference;
    if (pref !== undefined && typeof pref === "string" && !UI_THEMES.has(pref as UiTheme)) {
      return `unknown theme preference: ${pref}`;
    }
  }
  if (ns === "mcp") {
    return validateMcpServersValue(value.servers);
  }
  return undefined;
}

export interface FaceMcpServerDraft {
  readonly serverName: string;
  readonly command?: string;
  readonly url?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
}

/** Parse Face/host-settings MCP drafts. `env` is dropped (never copied). Mutate rejects env. */
export function parseFaceMcpServers(raw: unknown): FaceMcpServerDraft[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error("mcp.servers must be an array");
  }
  const out: FaceMcpServerDraft[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("mcp.servers entries must be objects");
    }
    const o = row as Record<string, unknown>;
    const serverName = String(o.serverName ?? "").trim();
    if (!serverName) throw new Error("mcp.servers entry needs serverName");
    const url = typeof o.url === "string" ? o.url.trim() : "";
    const command = typeof o.command === "string" ? o.command.trim() : "";
    if (!url && !command) {
      throw new Error("mcp.servers entry needs command or url");
    }
    out.push({
      serverName,
      ...(url ? { url } : { command }),
      ...(Array.isArray(o.args) ? { args: o.args.map((a) => String(a)) } : {}),
      ...(typeof o.cwd === "string" && o.cwd.trim()
        ? { cwd: o.cwd.trim() }
        : {}),
    });
  }
  return out;
}

function mcpServersContainEnv(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  return raw.some(
    (row) =>
      row !== null &&
      typeof row === "object" &&
      !Array.isArray(row) &&
      (row as { env?: unknown }).env !== undefined,
  );
}

function validateMcpServersValue(raw: unknown): string | undefined {
  if (mcpServersContainEnv(raw)) {
    return "mcp.servers must not include env; use process environment / credentials";
  }
  try {
    parseFaceMcpServers(raw);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const MCP_SETTINGS_NOTE =
  "Desired servers persist in .xrk/host-settings.json and apply on the next Host spawn. Live connect still needs XRK_MCP_ALLOW=1 (or policy allow). Not a process supervisor.";

function mcpConnected(runtime: FaceRuntime): readonly {
  readonly id: string;
  readonly serverName: string;
  readonly kind: string;
  readonly toolCount: number;
}[] {
  return (runtime.plugins ?? [])
    .filter((p) => p.id.startsWith("mcp:"))
    .map((p) => ({
      id: p.id,
      serverName: p.id.slice("mcp:".length),
      kind: p.kind,
      toolCount: p.tools?.length ?? 0,
    }));
}

function mcpDescribeBase(runtime: FaceRuntime): Record<string, unknown> {
  return {
    servers: [],
    connected: mcpConnected(runtime),
    note: MCP_SETTINGS_NOTE,
  };
}

function mcpMutateRejected(
  ops: readonly DshSettingsPathOp[],
): string | undefined {
  for (const op of ops) {
    if (op.path.length === 0) continue;
    if (op.path[0] !== "servers") {
      return "mcp only accepts servers (connected is live overlay)";
    }
  }
  return undefined;
}

/** DeepSeek `settings.describe` — namespaces[] for Web welcome / forms. */
export async function settingsDescribeDsh(
  runtime: FaceRuntime,
): Promise<FaceRpcResult<unknown>> {
  const namespaces: DshSettingsNamespaceView[] = [
    runtime.settingsNamespaces.view(
      "ui-onboarding",
      {},
      DSH_ONBOARDING_SCHEMA,
    ),
    runtime.settingsNamespaces.view(
      "ui",
      {
        theme: runtime.uiSettings.theme,
        locale: runtime.uiSettings.locale,
      },
      DSH_EMPTY_OBJECT_SCHEMA,
    ),
    runtime.settingsNamespaces.view(
      "locale",
      { preference: dshLocalePreference(runtime.uiSettings.locale) },
      LOCALE_SCHEMA,
    ),
    runtime.settingsNamespaces.view(
      "ui-theme",
      { preference: runtime.uiSettings.theme },
      THEME_SCHEMA,
    ),
    runtime.settingsNamespaces.view(
      "permission",
      { defaultPreset: "workspace-write" },
      DSH_PERMISSION_SCHEMA,
    ),
    runtime.settingsNamespaces.view("llm", { providers: {} }, DSH_LLM_SCHEMA),
    runtime.settingsNamespaces.view(
      "mcp",
      mcpDescribeBase(runtime),
      DSH_MCP_SCHEMA,
      "restart",
    ),
  ];
  if (runtime.hostPublic) {
    namespaces.push(
      runtime.settingsNamespaces.view(
        "host",
        { ...runtime.hostPublic },
        DSH_EMPTY_OBJECT_SCHEMA,
      ),
    );
  }
  return {
    ok: true,
    value: {
      writable: true,
      hasDocument: true,
      namespaces,
    },
  };
}

/** DeepSeek `settings.mutate` — path ops (welcome notice ack). */
export async function settingsMutateDsh(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<FaceRpcResult<unknown>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const ns = typeof p.ns === "string" ? p.ns.trim() : "";
  const opsRaw = Array.isArray(p.ops) ? p.ops : null;
  if (!ns || !opsRaw) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "ns and ops required",
      },
    };
  }
  const ops: DshSettingsPathOp[] = [];
  for (const raw of opsRaw) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const path = Array.isArray(o.path)
      ? o.path.filter((x): x is string => typeof x === "string")
      : [];
    if (o.op === "unset") ops.push({ op: "unset", path });
    else if (o.op === "set") ops.push({ op: "set", path, value: o.value });
  }
  const expected =
    typeof p.expectedRevision === "number" ? p.expectedRevision : undefined;
  if (ns === "mcp") {
    const mcpReject = mcpMutateRejected(ops);
    if (mcpReject) {
      return {
        ok: false,
        error: { code: "settings-invalid", message: mcpReject, details: { ns } },
      };
    }
  }
  const result = runtime.settingsNamespaces.mutate(ns, ops, expected);
  if (!result.ok) {
    return {
      ok: false,
      error: { code: result.code, message: result.message, details: { ns } },
    };
  }
  applyDshUiPref(
    runtime,
    ns,
    result.view.value as Record<string, unknown>,
  );
  publishRemoteEvent(runtime.bus, "settings/document-updated", [
    ns,
    result.view.revision,
  ]);
  if (ns === "llm") {
    publishRemoteEvent(runtime.bus, "llm/adapters-updated", []);
  }
  if (ns === "mcp") {
    const slot = runtime.settingsNamespaces.ensure("mcp");
    slot.user = { servers: mcpServersFromRuntime(runtime) };
    slot.applies = "restart";
    await persistHostSettings(runtime);
    return {
      ok: true,
      value: runtime.settingsNamespaces.view(
        "mcp",
        mcpDescribeBase(runtime),
        DSH_MCP_SCHEMA,
        "restart",
      ),
    };
  }
  return { ok: true, value: result.view };
}

/** DeepSeek `settings.update` — merge patch into namespace user layer. */
export async function settingsUpdateDsh(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<FaceRpcResult<unknown>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const ns = typeof p.ns === "string" ? p.ns.trim() : "";
  const patch =
    p.patch && typeof p.patch === "object" && !Array.isArray(p.patch)
      ? (p.patch as Record<string, unknown>)
      : null;
  if (!ns || !patch) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "ns and patch required",
      },
    };
  }
  const ops: DshSettingsPathOp[] = Object.entries(patch).map(([key, value]) => ({
    op: "set" as const,
    path: [key],
    value,
  }));
  return settingsMutateDsh(runtime, {
    ns,
    ops,
    ...(typeof p.expectedRevision === "number"
      ? { expectedRevision: p.expectedRevision }
      : {}),
  });
}

/** DeepSeek `settings.replace` — replace entire user section for ns. */
export async function settingsReplaceDsh(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<FaceRpcResult<unknown>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const ns = typeof p.ns === "string" ? p.ns.trim() : "";
  const section =
    p.section && typeof p.section === "object" && !Array.isArray(p.section)
      ? (p.section as Record<string, unknown>)
      : null;
  if (!ns || !section) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "ns and section required",
      },
    };
  }
  return settingsMutateDsh(runtime, {
    ns,
    ops: [{ op: "set", path: [], value: section }],
    ...(typeof p.expectedRevision === "number"
      ? { expectedRevision: p.expectedRevision }
      : {}),
  });
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function hostSettingsPath(runtime: FaceRuntime): string {
  const dir =
    runtime.productDir ?? path.join(runtime.workspaceRoot, ".xrk");
  return path.join(dir, "host-settings.json");
}

function mcpServersFromRuntime(runtime: FaceRuntime): FaceMcpServerDraft[] {
  try {
    return parseFaceMcpServers(
      runtime.settingsNamespaces.ensure("mcp").user.servers,
    );
  } catch {
    return [];
  }
}

/** Load `{productDir}/host-settings.json` mcp.servers into the namespace user layer. */
export function hydrateFaceHostSettings(runtime: FaceRuntime): void {
  const file = hostSettingsPath(runtime);
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      mcp?: { servers?: unknown };
    };
    const servers = parseFaceMcpServers(parsed.mcp?.servers);
    const slot = runtime.settingsNamespaces.ensure("mcp");
    slot.user = { servers };
    slot.applies = "restart";
  } catch {
    /* missing or malformed dump — next mutate rewrites */
  }
}

async function persistHostSettings(runtime: FaceRuntime): Promise<void> {
  const dump = hostSettingsPath(runtime);
  await mkdir(path.dirname(dump), { recursive: true });
  let previous: Record<string, unknown> = {};
  if (await fileExists(dump)) {
    try {
      const parsed = JSON.parse(await readFile(dump, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        previous = parsed as Record<string, unknown>;
      }
    } catch {
      previous = {};
    }
  }
  const body = {
    ...previous,
    note: "Redacted Host snapshot. Secrets are never written here.",
    ui: runtime.uiSettings,
    host: runtime.hostPublic ?? previous.host ?? null,
    policyFile:
      runtime.settingsDocumentPath &&
      path.isAbsolute(runtime.settingsDocumentPath)
        ? runtime.settingsDocumentPath
        : (previous.policyFile ?? null),
    mcp: { servers: mcpServersFromRuntime(runtime) },
  };
  await writeFile(dump, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

/**
 * Host-resolved settings document. Ignores any client-supplied path.
 * Prefer `XRK_POLICY_FILE` when present; otherwise a redacted dump under `.xrk/`.
 */
export async function prepareSettingsDocument(
  runtime: FaceRuntime,
): Promise<string> {
  const pinned = runtime.settingsDocumentPath?.trim();
  if (pinned && path.isAbsolute(pinned) && (await fileExists(pinned))) {
    return pinned;
  }
  await persistHostSettings(runtime);
  return hostSettingsPath(runtime);
}

/**
 * DeepSeek pathless `settings.openDocument`.
 * Wire value is only `{ opened: true }` (DSH schema); non-desktop → NI.
 */
export async function settingsOpenDocument(
  runtime: FaceRuntime,
): Promise<FaceRpcResult<{ opened: true }>> {
  let target: string;
  try {
    target = await prepareSettingsDocument(runtime);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "internal",
        message: `settings document preparation failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
  if (!canOpenNativePath()) {
    return {
      ok: false,
      error: {
        code: "not-implemented",
        message: "settings.openDocument unsupported on this platform",
      },
    };
  }
  try {
    if (runtime.openNativePath) {
      await runtime.openNativePath(target);
    } else {
      await openNativePath(target);
    }
    return { ok: true, value: { opened: true } };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "internal",
        message: `settings document open failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}
