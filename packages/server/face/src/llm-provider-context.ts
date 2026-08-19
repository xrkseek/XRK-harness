/**
 * Shared provider route + credential resolution for discovery, catalog, and agent LLM wiring.
 */
import type {
  AuthMode,
  ProtocolId,
  ProviderRegistry,
} from "@xrkseek/llm-registry";
import { normalizeProtocolId } from "@xrkseek/llm-registry";
import type { FaceRuntime } from "./context.js";
import { mergeLayers } from "./settings-document.js";
import { normalizeApiKey, apiKeyRefForProvider } from "./llm-api-key.js";

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

function mergedNamespace(
  runtime: FaceRuntime,
  ns: string,
): Record<string, unknown> {
  const slot = runtime.settingsNamespaces.ensure(ns);
  return mergeLayers(
    slot.base,
    slot.user,
  );
}

function piAiProviderProfile(
  runtime: FaceRuntime,
  provider: string,
): Record<string, unknown> | undefined {
  const merged = mergedNamespace(runtime, "llm-pi-ai");
  const providers = merged.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return undefined;
  }
  const profile = (providers as Record<string, unknown>)[provider];
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return undefined;
  }
  return profile as Record<string, unknown>;
}

/** Effective route overrides from settings namespaces (DSH llm-deepseek / llm-pi-ai). */
export function readProviderRoute(
  runtime: FaceRuntime,
  provider: string,
): ProviderRouteContext {
  if (provider === "deepseek") {
    const merged = mergedNamespace(runtime, "llm-deepseek");
    const url = merged.baseURL ?? merged.baseUrl;
    return {
      ...(typeof url === "string" && url.trim()
        ? { baseUrl: url.trim() }
        : {}),
    };
  }
  const profile = piAiProviderProfile(runtime, provider);
  if (!profile) return {};
  const url = profile.baseURL ?? profile.baseUrl;
  const protocol = normalizeProtocolId(profile.api);
  return {
    ...(typeof url === "string" && url.trim() ? { baseUrl: url.trim() } : {}),
    ...(protocol ? { protocol } : {}),
  };
}

/** Credential precedence: typed probe → vault → env (DSH credentials seam). */
export function readProviderApiKey(
  runtime: FaceRuntime,
  provider: string,
  typed?: string,
): ProviderCredentialContext {
  const trimmed = typed?.trim();
  if (trimmed) {
    const checked = normalizeApiKey(trimmed);
    if (!checked.ok) {
      const ref = apiKeyRefForProvider(
        runtime.registry.listBrands().find((b) => b.id === provider)?.apiKeyEnv,
      );
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
  const brand = runtime.registry.listBrands().find((b) => b.id === provider);
  const envName = brand?.apiKeyEnv;
  if (envName) {
    const fromEnv = process.env[envName]?.trim();
    if (fromEnv) {
      const checked = normalizeApiKey(fromEnv);
      if (!checked.ok) {
        throw new Error(`environment ${envName} resolves to an unusable API key`);
      }
      return { apiKey: checked.value, source: "env" };
    }
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
    const brand = runtime.registry.listBrands().find((b) => b.id === provider);
    return !brand?.apiKeyEnv;
  } catch {
    return false;
  }
}

export function resolveProviderBinding(
  registry: ProviderRegistry,
  input: {
    readonly provider: string;
    readonly model: string;
    readonly route?: ProviderRouteContext;
  },
) {
  const route = input.route ?? {};
  return registry.resolve({
    provider: input.provider,
    model: input.model,
    ...(route.baseUrl ? { baseUrl: route.baseUrl } : {}),
    ...(route.path ? { path: route.path } : {}),
    ...(route.protocol ? { protocol: route.protocol } : {}),
  });
}
