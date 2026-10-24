/**
 * Face LLM route + credential resolution.
 *
 * Single entry for brand Registry routes and settings-declared
 * `llm-pi-ai.providers.<id>` (Custom provider card). Callers must not
 * `registry.resolve` for product selection — use {@link resolveProviderBinding}.
 */
import type {
  AuthMode,
  ProtocolId,
  ProviderBinding,
} from "@xrkseek/llm-registry";
import {
  defaultPathForProtocol,
  factoryKindForProtocol,
  normalizeProtocolId,
  REGISTRY_FALLBACK_MODEL,
} from "@xrkseek/llm-registry";
import type { FaceRuntime } from "./context.js";
import { mergeLayers } from "./settings-layers.js";
import { normalizeApiKey, apiKeyRefForProvider } from "./llm-api-key.js";
import {
  resolveOutboundProxyPreference,
  type OutboundProxyPreference,
} from "./llm-outbound-proxy.js";

export interface ProviderRouteContext {
  readonly baseUrl?: string;
  readonly path?: string;
  readonly authMode?: AuthMode;
  /** Face `llm-pi-ai.providers.*.api` → Registry protocol. */
  readonly protocol?: ProtocolId;
}

export interface ProviderCredentialContext {
  readonly apiKey?: string;
  readonly source: "typed" | "vault" | "env" | "none";
}

/** One hand-declared `llm-pi-ai.providers.<id>` that is not a Registry brand. */
export type DeclaredPiAiProvider = {
  readonly id: string;
  readonly displayName: string;
  readonly baseUrl?: string;
  readonly api?: string;
  readonly models: readonly {
    readonly id: string;
    readonly name?: string;
    readonly inputModalities?: readonly ("text" | "image")[];
    readonly contextWindow?: number;
    readonly softBudgetMaxTokens?: number;
    readonly softBudgetKeepTokens?: number;
    readonly softBudgetBufferTokens?: number;
  }[];
};

function mergedNamespace(
  runtime: FaceRuntime,
  ns: string,
): Record<string, unknown> {
  const slot = runtime.settingsNamespaces.ensure(ns);
  return mergeLayers(slot.base, slot.user);
}

/**
 * Endpoint URL from a settings profile.
 * Prefer schema `baseURL`; keep `baseUrl` as wire/legacy alias (do not drop).
 */
function settingsBaseURL(obj: Record<string, unknown>): string | undefined {
  const url = obj.baseURL ?? obj.baseUrl;
  if (typeof url !== "string" || !url.trim()) return undefined;
  return url.trim().replace(/\/+$/, "");
}

function piAiProvidersDict(
  runtime: FaceRuntime,
): Record<string, Record<string, unknown>> | undefined {
  const providers = mergedNamespace(runtime, "llm-pi-ai").providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return undefined;
  }
  const out: Record<string, Record<string, unknown>> = {};
  for (const [id, raw] of Object.entries(providers)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    out[id] = raw as Record<string, unknown>;
  }
  return out;
}

/** Case-insensitive lookup into `llm-pi-ai.providers`. */
export function piAiProviderProfile(
  runtime: FaceRuntime,
  provider: string,
): Record<string, unknown> | undefined {
  const key = provider.trim();
  if (!key) return undefined;
  const dict = piAiProvidersDict(runtime);
  if (!dict) return undefined;
  if (dict[key]) return dict[key];
  const lower = key.toLowerCase();
  for (const [id, profile] of Object.entries(dict)) {
    if (id.toLowerCase() === lower) return profile;
  }
  return undefined;
}

function profilePositiveInt(
  row: object,
  key: string,
): number | undefined {
  const raw = (row as Record<string, unknown>)[key];
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) return raw;
  return undefined;
}

function profileNonNegInt(
  row: object,
  key: string,
): number | undefined {
  const raw = (row as Record<string, unknown>)[key];
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  return undefined;
}

function profileModels(
  profile: Record<string, unknown>,
): {
  id: string;
  name?: string;
  inputModalities?: readonly ("text" | "image")[];
  contextWindow?: number;
  softBudgetMaxTokens?: number;
  softBudgetKeepTokens?: number;
  softBudgetBufferTokens?: number;
}[] {
  const modelsRaw = profile.models;
  if (!Array.isArray(modelsRaw)) return [];
  const models: {
    id: string;
    name?: string;
    inputModalities?: readonly ("text" | "image")[];
    contextWindow?: number;
    softBudgetMaxTokens?: number;
    softBudgetKeepTokens?: number;
    softBudgetBufferTokens?: number;
  }[] = [];
  for (const row of modelsRaw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const mid = (row as { id?: unknown }).id;
    if (typeof mid !== "string" || !mid.trim()) continue;
    const name = (row as { name?: unknown }).name;
    const modsRaw = (row as { inputModalities?: unknown }).inputModalities;
    const inputModalities = Array.isArray(modsRaw)
      ? modsRaw
          .map((m) => String(m).trim())
          .filter((m): m is "text" | "image" => m === "text" || m === "image")
      : undefined;
    const contextWindow = profilePositiveInt(row, "contextWindow");
    const softBudgetMaxTokens = profilePositiveInt(row, "softBudgetMaxTokens");
    const softBudgetKeepTokens = profilePositiveInt(
      row,
      "softBudgetKeepTokens",
    );
    const softBudgetBufferTokens = profileNonNegInt(
      row,
      "softBudgetBufferTokens",
    );
    models.push({
      id: mid.trim(),
      ...(typeof name === "string" && name.trim()
        ? { name: name.trim() }
        : {}),
      ...(inputModalities && inputModalities.length > 0
        ? { inputModalities: [...new Set(inputModalities)] }
        : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(softBudgetMaxTokens !== undefined ? { softBudgetMaxTokens } : {}),
      ...(softBudgetKeepTokens !== undefined ? { softBudgetKeepTokens } : {}),
      ...(softBudgetBufferTokens !== undefined
        ? { softBudgetBufferTokens }
        : {}),
    });
  }
  return models;
}

function registryKnowsProvider(
  runtime: FaceRuntime,
  provider: string,
): boolean {
  const key = provider.trim().toLowerCase();
  if (!key) return false;
  return runtime.registry.listBrands().some((b) => b.id === key);
}

/**
 * Effective credential env name: brand → deepseek settings → pi-ai profile.
 */
export function providerApiKeyEnv(
  runtime: FaceRuntime,
  provider: string,
): string | undefined {
  const key = provider.trim().toLowerCase();
  const brand = runtime.registry.listBrands().find((b) => b.id === key);
  if (brand?.apiKeyEnv?.trim()) return brand.apiKeyEnv.trim();
  if (key === "deepseek") {
    const ref = mergedNamespace(runtime, "llm-deepseek").apiKeyEnv;
    if (typeof ref === "string" && ref.trim()) return ref.trim();
  }
  const profile = piAiProviderProfile(runtime, provider);
  const ref = profile?.apiKeyEnv;
  if (typeof ref === "string" && ref.trim()) return ref.trim();
  return undefined;
}

/**
 * Settings-declared providers that name an `apiKeyEnv` (credential slots).
 */
export function listSettingsProviderCredentialRefs(
  runtime: FaceRuntime,
): readonly { readonly providerId: string; readonly apiKeyEnv: string }[] {
  const out: { providerId: string; apiKeyEnv: string }[] = [];
  const seen = new Set<string>();

  const push = (providerId: string, apiKeyEnv: string) => {
    const id = providerId.trim();
    const env = apiKeyEnv.trim();
    if (!id || !env || seen.has(id)) return;
    seen.add(id);
    out.push({ providerId: id, apiKeyEnv: env });
  };

  const deepseek = mergedNamespace(runtime, "llm-deepseek");
  if (typeof deepseek.apiKeyEnv === "string" && deepseek.apiKeyEnv.trim()) {
    push("deepseek", deepseek.apiKeyEnv);
  }

  const dict = piAiProvidersDict(runtime);
  if (dict) {
    for (const [id, profile] of Object.entries(dict)) {
      const ref = profile.apiKeyEnv;
      if (typeof ref === "string" && ref.trim()) push(id, ref);
    }
  }

  return out;
}

/**
 * User preference for Settings → Models row order (`llm-pi-ai.providerOrder`).
 * Empty / absent → discovery order from {@link listDeclaredPiAiProviders} + brands.
 * Same list also orders composer `llm.models` groups (after
 * {@link catalogGroupIdFromProviderOrderEntry}).
 */
export function readProviderOrder(
  runtime: FaceRuntime,
): readonly string[] | undefined {
  const raw = mergedNamespace(runtime, "llm-pi-ai").providerOrder;
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (id) out.push(id);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Map a Settings `llm.providers` id onto an `llm.models` group id.
 * DeepSeek's directory row is `deepseek-official`; the catalog group stays `deepseek`.
 */
export function catalogGroupIdFromProviderOrderEntry(id: string): string {
  return id === "deepseek-official" ? "deepseek" : id;
}

/**
 * Stable-sort providers by a preferred id list; unknown preference ids are
 * skipped, and items missing from the preference keep relative discovery order
 * at the end.
 */
export function orderProvidersByPreference<T extends { readonly provider: string }>(
  providers: readonly T[],
  order: readonly string[] | undefined,
): T[] {
  if (order === undefined || order.length === 0) return [...providers];
  const byId = new Map(providers.map((row) => [row.provider, row]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    const hit = byId.get(id);
    if (hit === undefined || seen.has(id)) continue;
    out.push(hit);
    seen.add(id);
  }
  for (const row of providers) {
    if (!seen.has(row.provider)) out.push(row);
  }
  return out;
}

/**
 * Settings-only routes (Custom provider card). Excludes Registry brands.
 */
export function listDeclaredPiAiProviders(
  runtime: FaceRuntime,
): readonly DeclaredPiAiProvider[] {
  const brandIds = new Set(runtime.registry.listBrands().map((b) => b.id));
  const out: DeclaredPiAiProvider[] = [];
  const dict = piAiProvidersDict(runtime);
  if (!dict) return out;

  for (const [id, profile] of Object.entries(dict)) {
    const key = id.trim();
    if (!key || brandIds.has(key.toLowerCase())) continue;
    const displayName =
      typeof profile.displayName === "string" && profile.displayName.trim()
        ? profile.displayName.trim()
        : key;
    const baseUrl = settingsBaseURL(profile);
    const api = typeof profile.api === "string" ? profile.api.trim() : "";
    out.push({
      id: key,
      displayName,
      ...(baseUrl ? { baseUrl } : {}),
      ...(api ? { api } : {}),
      models: profileModels(profile),
    });
  }
  return out;
}

/** Effective route overrides from `llm-deepseek` / `llm-pi-ai`. */
export function readProviderRoute(
  runtime: FaceRuntime,
  provider: string,
): ProviderRouteContext {
  if (provider.trim().toLowerCase() === "deepseek") {
    const baseUrl = settingsBaseURL(
      mergedNamespace(runtime, "llm-deepseek"),
    );
    return baseUrl ? { baseUrl } : {};
  }
  const profile = piAiProviderProfile(runtime, provider);
  if (!profile) return {};
  const baseUrl = settingsBaseURL(profile);
  const protocol = normalizeProtocolId(profile.api);
  return {
    ...(baseUrl ? { baseUrl } : {}),
    ...(protocol ? { protocol } : {}),
  };
}

/**
 * Outbound proxy for one provider+model: model `proxy` beats provider `proxy`;
 * either may inherit (then Host env proxy / direct).
 */
export function readOutboundProxyPreference(
  runtime: FaceRuntime,
  provider: string,
  model: string,
): OutboundProxyPreference {
  const key = catalogGroupIdFromProviderOrderEntry(
    provider.trim().toLowerCase(),
  );
  const modelId = model.trim();
  let providerProxy: unknown;
  let modelProxy: unknown;
  if (key === "deepseek") {
    const profile = mergedNamespace(runtime, "llm-deepseek");
    providerProxy = profile.proxy;
    if (modelId && Array.isArray(profile.models)) {
      for (const row of profile.models) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        const id = (row as { id?: unknown }).id;
        if (typeof id === "string" && id.trim() === modelId) {
          modelProxy = (row as { proxy?: unknown }).proxy;
          break;
        }
      }
    }
  } else {
    const profile = piAiProviderProfile(runtime, provider);
    providerProxy = profile?.proxy;
    if (profile && modelId && Array.isArray(profile.models)) {
      for (const row of profile.models) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        const id = (row as { id?: unknown }).id;
        if (typeof id === "string" && id.trim() === modelId) {
          modelProxy = (row as { proxy?: unknown }).proxy;
          break;
        }
      }
    }
  }
  return resolveOutboundProxyPreference(modelProxy, providerProxy);
}

/** Credential precedence: typed probe → vault → env. */
export function readProviderApiKey(
  runtime: FaceRuntime,
  provider: string,
  typed?: string,
): ProviderCredentialContext {
  const trimmed = typed?.trim();
  if (trimmed) {
    const checked = normalizeApiKey(trimmed);
    if (!checked.ok) {
      const ref = apiKeyRefForProvider(providerApiKeyEnv(runtime, provider));
      throw new Error(
        checked.reason === "empty"
          ? `API key for ${provider} is blank`
          : `API key for ${provider} (${ref}) contains characters no HTTP header can carry`,
      );
    }
    return { apiKey: checked.value, source: "typed" };
  }
  const fromVault = runtime.credentials.peek(`llm.${provider}`)?.trim();
  if (fromVault) {
    const checked = normalizeApiKey(fromVault);
    if (!checked.ok) {
      throw new Error(`stored API key for ${provider} is unusable`);
    }
    return { apiKey: checked.value, source: "vault" };
  }
  const envName = providerApiKeyEnv(runtime, provider);
  const key = provider.trim().toLowerCase();
  // OpenCode Go accepts the Zen key as env fallback.
  const envCandidates =
    key === "opencode-go"
      ? [envName, "OPENCODE_API_KEY"]
      : key === "opencode"
        ? [envName, "OPENCODE_API_KEY"]
        : [envName];
  for (const name of envCandidates) {
    if (!name) continue;
    const fromEnv = process.env[name]?.trim();
    if (!fromEnv) continue;
    const checked = normalizeApiKey(fromEnv);
    if (!checked.ok) {
      throw new Error(`environment ${name} resolves to an unusable API key`);
    }
    return { apiKey: checked.value, source: "env" };
  }
  return { source: "none" };
}

/** Whether this provider can authenticate for a live adapter. */
export function providerHasUsableCredential(
  runtime: FaceRuntime,
  provider: string,
): boolean {
  try {
    const cred = readProviderApiKey(runtime, provider);
    if (cred.apiKey) return true;
    const envName = providerApiKeyEnv(runtime, provider);
    return envName === undefined;
  } catch {
    return false;
  }
}

function synthesizeDeclaredBinding(
  runtime: FaceRuntime,
  provider: string,
  model: string,
  route: ProviderRouteContext,
): ProviderBinding | undefined {
  const key = provider.trim().toLowerCase();
  if (!key || registryKnowsProvider(runtime, key)) return undefined;
  const profile = piAiProviderProfile(runtime, provider);
  if (!profile) return undefined;

  const protocol = route.protocol ?? normalizeProtocolId(profile.api);
  const baseUrl = route.baseUrl ?? settingsBaseURL(profile);
  if (!protocol || !baseUrl) return undefined;

  const displayName =
    typeof profile.displayName === "string" && profile.displayName.trim()
      ? profile.displayName.trim()
      : key;
  const pathRaw = route.path?.trim() || defaultPathForProtocol(protocol);
  const path = pathRaw.startsWith("/") ? pathRaw : `/${pathRaw}`;
  const authMode: AuthMode =
    route.authMode ??
    (protocol === "anthropic-messages" || protocol === "gemini-generate"
      ? "api-key"
      : "bearer");
  const apiKeyEnv = providerApiKeyEnv(runtime, key);
  const models = profileModels(profile);
  const modelTrim = model.trim();
  const fallbackModel = models[0]?.id ?? REGISTRY_FALLBACK_MODEL;

  return {
    provider: key,
    protocol,
    factoryKind: factoryKindForProtocol(protocol),
    model: modelTrim || fallbackModel,
    baseUrl,
    path,
    authMode,
    displayName,
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
  };
}

/**
 * Resolve Registry brand, or synthesize from `llm-pi-ai.providers.<id>`.
 * Optional `route` overlays settings (e.g. discovery draft `baseURL`).
 */
export function resolveProviderBinding(
  runtime: FaceRuntime,
  input: {
    readonly provider: string;
    readonly model: string;
    readonly route?: ProviderRouteContext;
  },
): ProviderBinding {
  const route: ProviderRouteContext = {
    ...readProviderRoute(runtime, input.provider),
    ...input.route,
  };
  if (registryKnowsProvider(runtime, input.provider)) {
    return runtime.registry.resolve({
      provider: input.provider,
      model: input.model,
      ...(route.baseUrl ? { baseUrl: route.baseUrl } : {}),
      ...(route.path ? { path: route.path } : {}),
      ...(route.protocol ? { protocol: route.protocol } : {}),
    });
  }
  const synthesized = synthesizeDeclaredBinding(
    runtime,
    input.provider,
    input.model,
    route,
  );
  if (synthesized) return synthesized;
  throw new Error(
    `llm-registry: unknown provider: ${input.provider.trim().toLowerCase() || input.provider}`,
  );
}

/** Whether a provider id can resolve to a live binding (not API-key gated). */
export function providerRouteServed(
  runtime: FaceRuntime,
  provider: string,
): boolean {
  const id = provider.trim();
  if (!id) return false;
  try {
    resolveProviderBinding(runtime, { provider: id, model: "_" });
    return true;
  } catch {
    return false;
  }
}
