import type { LlmAdapter } from "@xrkseek/llm";
import { createAnthropicAdapter } from "@xrkseek/llm-anthropic";
import { isOfficialDeepSeekBaseUrl } from "@xrkseek/llm-deepseek";
import { createGeminiAdapter } from "@xrkseek/llm-gemini";
import { createOpenAiCompatibleAdapter } from "@xrkseek/llm-openai-compatible";
import { createOpenAiResponsesAdapter } from "@xrkseek/llm-openai-responses";
import { OPENAI_CHAT_BRANDS } from "./brands-openai-chat.js";
import { R1_PROTOCOL_BRANDS } from "./brands-r1.js";
import type {
  BrandEntry,
  ProtocolId,
  ProviderBinding,
  ResolveInput,
  RoutableProvider,
} from "./types.js";
import {
  defaultPathForProtocol,
  factoryKindForProtocol,
  normalizeProtocolId,
} from "./types.js";

/** When brand and input omit model. */
export const REGISTRY_FALLBACK_MODEL = "gpt-4o-mini";

export const DEFAULT_REGISTRY_BRANDS: readonly BrandEntry[] = [
  ...OPENAI_CHAT_BRANDS,
  ...R1_PROTOCOL_BRANDS,
];

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
      inputModalities?: readonly ("text" | "image")[];
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
  for (const b of options.brands ?? DEFAULT_REGISTRY_BRANDS) {
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
      const protocol: ProtocolId =
        normalizeProtocolId(input.protocol) ?? brand.protocol;
      const protocolOverridden =
        normalizeProtocolId(input.protocol) !== undefined &&
        normalizeProtocolId(input.protocol) !== brand.protocol;

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
        (protocolOverridden ? undefined : brand.path) ||
        defaultPathForProtocol(protocol);
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      const model =
        (typeof input.model === "string" && input.model.trim()) ||
        brand.defaultModel ||
        registryDefaultModel ||
        REGISTRY_FALLBACK_MODEL;
      const authMode =
        brand.authMode ??
        (protocol === "anthropic-messages" || protocol === "gemini-generate"
          ? "api-key"
          : "bearer");

      const apiKeyEnv = brand.apiKeyEnv;
      return {
        provider: providerKey,
        protocol,
        factoryKind: factoryKindForProtocol(protocol),
        model,
        baseUrl,
        path: normalizedPath,
        authMode,
        displayName: brand.displayName,
        ...(apiKeyEnv ? { apiKeyEnv } : {}),
      };
    },

    createAdapter(binding, secrets, extras) {
      const id = extras?.id ?? binding.provider;
      const model = extras?.model ?? binding.model;
      const fetchImpl = extras?.fetch;
      const apiKey = secrets.apiKey;

      if (
        binding.protocol === "openai-chat" ||
        binding.protocol === "openai-completions"
      ) {
        const vision =
          extras?.inputModalities ??
          (binding.provider === "deepseek" &&
          isOfficialDeepSeekBaseUrl(binding.baseUrl)
            ? ["text"]
            : ["text", "image"]);
        return createOpenAiCompatibleAdapter({
          id,
          baseUrl: binding.baseUrl,
          path: binding.path,
          authMode: binding.authMode,
          model,
          inputModalities: vision,
          ...(apiKey !== undefined ? { apiKey } : {}),
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
        });
      }

      if (binding.protocol === "anthropic-messages") {
        return createAnthropicAdapter({
          id,
          baseUrl: binding.baseUrl,
          path: binding.path,
          model,
          inputModalities: extras?.inputModalities ?? ["text", "image"],
          ...(apiKey !== undefined ? { apiKey } : {}),
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
        });
      }

      if (binding.protocol === "openai-responses") {
        return createOpenAiResponsesAdapter({
          id,
          baseUrl: binding.baseUrl,
          path: binding.path,
          model,
          inputModalities: extras?.inputModalities ?? ["text", "image"],
          ...(apiKey !== undefined ? { apiKey } : {}),
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
        });
      }

      if (binding.protocol === "gemini-generate") {
        return createGeminiAdapter({
          id,
          baseUrl: binding.baseUrl,
          model,
          inputModalities: extras?.inputModalities ?? ["text", "image"],
          ...(apiKey !== undefined ? { apiKey } : {}),
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
        });
      }

      throw new Error(
        `llm-registry: createAdapter unsupported protocol: ${
          (binding).protocol
        }`,
      );
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
