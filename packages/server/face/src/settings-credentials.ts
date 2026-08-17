/**
 * Face U2 settings + credentials — public settings writable; secrets never logged / never on disk.
 */

import type { FaceRuntime } from "./context.js";
import type { FaceRpcResult } from "./types.js";

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
 * Not file-backed — enough for loopback UI ack / live prefs.
 */
export class FaceSettingsNamespaces {
  private readonly map = new Map<
    string,
    { user: Record<string, unknown>; revision: number }
  >();

  ensure(ns: string): { user: Record<string, unknown>; revision: number } {
    let slot = this.map.get(ns);
    if (!slot) {
      slot = { user: {}, revision: 0 };
      this.map.set(ns, slot);
    }
    return slot;
  }

  view(
    ns: string,
    base: Record<string, unknown> = {},
  ): DshSettingsNamespaceView {
    const slot = this.ensure(ns);
    return {
      ns,
      schema: {},
      value: { ...base, ...slot.user },
      base,
      user: { ...slot.user },
      applies: "live",
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
    for (const op of ops) {
      if (op.op === "set") setAtPath(slot.user, op.path, op.value);
      else unsetAtPath(slot.user, op.path);
    }
    slot.revision += 1;
    return { ok: true, view: this.view(ns) };
  }
}

/** DeepSeek `settings.describe` — namespaces[] for Web welcome / forms. */
export async function settingsDescribeDsh(
  runtime: FaceRuntime,
): Promise<FaceRpcResult<unknown>> {
  const namespaces: DshSettingsNamespaceView[] = [
    runtime.settingsNamespaces.view("ui-onboarding"),
    runtime.settingsNamespaces.view("ui", {
      theme: runtime.uiSettings.theme,
      locale: runtime.uiSettings.locale,
    }),
  ];
  if (runtime.hostPublic) {
    namespaces.push(
      runtime.settingsNamespaces.view("host", {
        ...runtime.hostPublic,
      }),
    );
  }
  return {
    ok: true,
    value: {
      writable: true,
      hasDocument: false,
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
  const result = runtime.settingsNamespaces.mutate(ns, ops, expected);
  if (!result.ok) {
    return {
      ok: false,
      error: { code: result.code, message: result.message },
    };
  }
  // Keep XRK uiSettings in sync when ns=ui
  if (ns === "ui") {
    const v = result.view.value as Record<string, unknown>;
    if (typeof v.theme === "string" && UI_THEMES.has(v.theme as UiTheme)) {
      runtime.uiSettings.theme = v.theme as UiTheme;
    }
    if (typeof v.locale === "string" && v.locale.trim()) {
      runtime.uiSettings.locale = v.locale.trim().slice(0, MAX_LOCALE);
    }
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
