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

export async function credentialsSet(
  runtime: FaceRuntime,
  payload: unknown,
): Promise<FaceRpcResult<unknown>> {
  const p =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const slotId = typeof p.slotId === "string" ? p.slotId.trim() : "";
  if (!slotId) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "slotId required" },
    };
  }

  const known = listCredentialSlots(runtime).some((s) => s.id === slotId);
  if (!known) {
    return {
      ok: false,
      error: {
        code: "credentials-slot-not-found",
        message: `unknown slot: ${slotId}`,
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
