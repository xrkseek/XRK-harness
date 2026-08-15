import type { LlmAdapter } from "@xrkseek/llm";
import { createOpenAiCompatibleAdapter } from "@xrkseek/llm-openai-compatible";
import { OPENAI_CHAT_BRANDS } from "./brands-openai-chat.js";
import type {
  BrandEntry,
  ProviderBinding,
  ResolveInput,
  RoutableProvider,
} from "./types.js";

/** When brand and input omit model. */
export const REGISTRY_FALLBACK_MODEL = "gpt-4o-mini";

const DEFAULT_PATH = "/chat/completions";

export interface ProviderRegistry {
  registerBrand(entry: BrandEntry): void;
  resolve(input: ResolveInput): ProviderBinding;
  createAdapter(
    binding: ProviderBinding,
    secrets: { apiKey?: string },
    extras?: {
      id?: string;
      fetch?: typeof fetch;
      model?: string;
    },
  ): LlmAdapter;
  listBrands(): readonly BrandEntry[];
  listRoutable(secretsEnv?: NodeJS.ProcessEnv): readonly RoutableProvider[];
}

export interface CreateProviderRegistryOptions {
  readonly brands?: readonly BrandEntry[];
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
}

function normalizeKey(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  return s.length > 0 ? s : undefined;
}

function isDefaultAlias(key: string): boolean {
  return key === "default" || key === "auto";
}

export function createProviderRegistry(
  options: CreateProviderRegistryOptions = {},
): ProviderRegistry {
  const brands = new Map<string, BrandEntry>();
  for (const b of options.brands ?? OPENAI_CHAT_BRANDS) {
    brands.set(b.id.toLowerCase(), b);
  }
  const registryDefaultProvider = normalizeKey(options.defaultProvider);
  const registryDefaultModel = options.defaultModel;

  return {
    registerBrand(entry) {
      const id = entry.id.trim().toLowerCase();
      if (brands.has(id)) {
        throw new Error(`llm-registry: brand already registered: ${id}`);
      }
      brands.set(id, { ...entry, id });
    },

    resolve(input) {
      const allowDefaultAliases = input.allowDefaultAliases === true;
      const candidates = [
        input.provider,
        input.llm,
        input.profile,
        input.defaultProvider,
        registryDefaultProvider,
      ];

      let providerKey: string | undefined;
      for (const c of candidates) {
        const key = normalizeKey(c);
        if (!key) continue;
        if (isDefaultAlias(key) && !allowDefaultAliases) continue;
        if (isDefaultAlias(key) && allowDefaultAliases && !brands.has(key)) {
          continue;
        }
        if (!brands.has(key)) {
          throw new Error(`llm-registry: unknown provider: ${key}`);
        }
        providerKey = key;
        break;
      }

      if (!providerKey) {
        throw new Error(
          "llm-registry: no provider resolved (set provider or XRK_LLM_PRESET / defaultProvider)",
        );
      }

      const brand = brands.get(providerKey)!;
      const baseUrl = (input.baseUrl?.trim() || brand.baseUrl || "").replace(
        /\/+$/,
        "",
      );
      if (!baseUrl) {
        throw new Error(
          `llm-registry: baseUrl required for provider: ${providerKey}`,
        );
      }

      const path =
        input.path?.trim() ||
        brand.path ||
        DEFAULT_PATH;
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      const model =
        (typeof input.model === "string" && input.model.trim()) ||
        brand.defaultModel ||
        registryDefaultModel ||
        REGISTRY_FALLBACK_MODEL;
      const authMode = brand.authMode ?? "bearer";

      if (brand.protocol !== "openai-chat") {
        throw new Error(
          `llm-registry: unsupported protocol in R0: ${brand.protocol}`,
        );
      }

      const apiKeyEnv = brand.apiKeyEnv;
      return {
        provider: providerKey,
        protocol: "openai-chat",
        factoryKind: "compat",
        model,
        baseUrl,
        path: normalizedPath,
        authMode,
        displayName: brand.displayName,
        ...(apiKeyEnv ? { apiKeyEnv } : {}),
      };
    },

    createAdapter(binding, secrets, extras) {
      if (binding.protocol !== "openai-chat") {
        throw new Error(
          `llm-registry: createAdapter unsupported protocol: ${binding.protocol}`,
        );
      }
      return createOpenAiCompatibleAdapter({
        id: extras?.id ?? binding.provider,
        baseUrl: binding.baseUrl,
        path: binding.path,
        authMode: binding.authMode,
        model: extras?.model ?? binding.model,
        ...(secrets.apiKey !== undefined ? { apiKey: secrets.apiKey } : {}),
        ...(extras?.fetch ? { fetch: extras.fetch } : {}),
      });
    },

    listBrands() {
      return [...brands.values()];
    },

    listRoutable(secretsEnv = process.env) {
      const out: RoutableProvider[] = [];
      for (const b of brands.values()) {
        const keyOk =
          !b.apiKeyEnv ||
          Boolean(
            secretsEnv[b.apiKeyEnv] &&
              String(secretsEnv[b.apiKeyEnv]).trim().length > 0,
          );
        // active = has baseUrl (or ollama) AND (no apiKeyEnv OR env has key)
        const active =
          (Boolean(b.baseUrl) || b.id === "ollama") &&
          (!b.apiKeyEnv || keyOk);
        out.push({
          id: b.id,
          displayName: b.displayName,
          active,
        });
      }
      return out;
    },
  };
}
