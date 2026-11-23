import type { LlmAdapter, SystemPromptUpdate, ToolUpdate } from "@xrkseek/llm";
import { createAnthropicAdapter } from "@xrkseek/llm-anthropic";
import {
  createDeepSeekAdapter,
  isOfficialDeepSeekBaseUrl,
  isOfficialDeepSeekMessagesBaseUrl,
  resolveDeepSeekInputModalities,
  resolveDeepSeekToolUpdate,
} from "@xrkseek/llm-deepseek";
import { createGeminiAdapter } from "@xrkseek/llm-gemini";
import { createOpenAiCompatibleAdapter } from "@xrkseek/llm-openai-compatible";
import { createOpenAiResponsesAdapter } from "@xrkseek/llm-openai-responses";
import { OPENAI_CHAT_BRANDS } from "./brands-openai-chat.js";
import { R1_PROTOCOL_BRANDS } from "./brands-r1.js";
import { conversationUpdates } from "./conversation-updates.js";
import {
  responsesPromptCacheKey,
  sessionAffinityHeaders,
} from "./session-affinity.js";
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

type AdapterExtras = {
  readonly sessionId?: string;
  readonly headers?: Record<string, string>;
  readonly systemPromptUpdate?: SystemPromptUpdate | false;
  readonly toolUpdate?: ToolUpdate | false;
};

/** Merge session affinity + caller headers (caller wins on key clash). */
function mergeSessionHeaders(
  binding: ProviderBinding,
  extras?: AdapterExtras,
): Record<string, string> | undefined {
  const session = sessionAffinityHeaders(binding, extras?.sessionId);
  const headers = {
    ...(session ?? {}),
    ...(extras?.headers ?? {}),
  };
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * Shared wire: session affinity headers + protocol `conversationUpdates`
 * (system series + toolUpdate when the protocol can carry them).
 */
function sharedAdapterWire(
  binding: ProviderBinding,
  extras?: AdapterExtras,
): {
  readonly headers?: Record<string, string>;
  readonly systemPromptUpdate?: SystemPromptUpdate;
  readonly toolUpdate?: ToolUpdate;
} {
  const headers = mergeSessionHeaders(binding, extras);
  const updates = conversationUpdates({
    protocol: binding.protocol,
    ...(extras?.systemPromptUpdate !== undefined
      ? { systemPromptUpdate: extras.systemPromptUpdate }
      : {}),
    ...(extras?.toolUpdate !== undefined
      ? { toolUpdate: extras.toolUpdate }
      : {}),
  });
  return {
    ...(headers ? { headers } : {}),
    ...(updates.systemPromptUpdate
      ? { systemPromptUpdate: updates.systemPromptUpdate }
      : {}),
    ...(updates.toolUpdate ? { toolUpdate: updates.toolUpdate } : {}),
  };
}

export interface ProviderRegistry {
  registerBrand(entry: BrandEntry): void;
  /**
   * Drop a brand by id (case-insensitive). Used when a `kind: "llm"` plugin
   * remounts with a refreshed catalog (e.g. sunflower-free egress change).
   * @returns whether a brand was removed.
   */
  unregisterBrand(id: string): boolean;
  resolve(input: ResolveInput): ProviderBinding;
  createAdapter(
    binding: ProviderBinding,
    secrets: { apiKey?: string },
    extras?: {
      id?: string;
      fetch?: typeof fetch;
      model?: string;
      inputModalities?: readonly ("text" | "image")[];
      readImageRequest?: import("@xrkseek/llm-deepseek").DeepSeekReadImageRequest;
      /**
       * Harness session id → vendor affinity (`x-opencode-session` /
       * `x-session-id`) and Responses `prompt_cache_key`.
       */
      sessionId?: string;
      /** Extra outbound headers (merged after session affinity). */
      headers?: Record<string, string>;
      /**
       * Catalog / Face override for series system placement.
       * `false` forces leading-only; omit → protocol / compat default.
       */
      systemPromptUpdate?: SystemPromptUpdate | false;
      /**
       * Catalog / Face override for mid-conversation tool declarations.
       * Only applied on `anthropic-messages`; `false` withholds; omit → none.
       */
      toolUpdate?: ToolUpdate | false;
      /**
       * This route advertises thinking levels, so a chosen one may travel as
       * `reasoning_effort` (OpenAI-compatible protocols only).
       */
      reasoningEffortWire?: true;
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

    unregisterBrand(id) {
      const key = id.trim().toLowerCase();
      if (!key || !brands.has(key)) return false;
      return brands.delete(key);
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
          (binding.provider === "deepseek"
            ? resolveDeepSeekInputModalities({
                baseUrl: binding.baseUrl,
                model,
              })
            : ["text", "image"]);
        if (
          binding.provider === "deepseek" &&
          isOfficialDeepSeekBaseUrl(binding.baseUrl)
        ) {
          // Catalog owns systemPromptUpdate (Flash in-history / Pro withhold).
          // Still attach session affinity headers for sticky gateways — do not
          // let protocol-default conversationUpdates override Pro withhold.
          const headers = mergeSessionHeaders(binding, extras);
          return createDeepSeekAdapter({
            id,
            baseUrl: binding.baseUrl,
            model,
            inputModalities: vision,
            ...(apiKey !== undefined ? { apiKey } : {}),
            ...(fetchImpl ? { fetch: fetchImpl } : {}),
            ...(headers ? { headers } : {}),
            ...(extras?.readImageRequest
              ? { readImageRequest: extras.readImageRequest }
              : {}),
          });
        }
        const wire = sharedAdapterWire(binding, extras);
        return createOpenAiCompatibleAdapter({
          id,
          baseUrl: binding.baseUrl,
          path: binding.path,
          authMode: binding.authMode,
          model,
          inputModalities: vision,
          ...(apiKey !== undefined ? { apiKey } : {}),
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
          ...wire,
          ...(extras?.reasoningEffortWire === true
            ? { reasoningEffortWire: true as const }
            : {}),
        });
      }

      if (binding.protocol === "anthropic-messages") {
        // DeepSeek Messages Flash declares addition-only; Chat Completions brand
        // never reaches here. Catalog fills only when Face/extras omit a value.
        const catalogToolUpdate = isOfficialDeepSeekMessagesBaseUrl(
          binding.baseUrl,
        )
          ? resolveDeepSeekToolUpdate(model)
          : undefined;
        const wire = sharedAdapterWire(binding, {
          ...extras,
          ...(extras?.toolUpdate === undefined && catalogToolUpdate
            ? { toolUpdate: catalogToolUpdate }
            : {}),
        });
        return createAnthropicAdapter({
          id,
          baseUrl: binding.baseUrl,
          path: binding.path,
          model,
          inputModalities: extras?.inputModalities ?? ["text", "image"],
          ...(apiKey !== undefined ? { apiKey } : {}),
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
          ...(binding.authMode === "bearer"
            ? { authMode: "bearer" as const }
            : {}),
          ...wire,
        });
      }

      if (binding.protocol === "openai-responses") {
        const wire = sharedAdapterWire(binding, extras);
        const cacheKey = responsesPromptCacheKey(
          binding.protocol,
          extras?.sessionId,
        );
        return createOpenAiResponsesAdapter({
          id,
          baseUrl: binding.baseUrl,
          path: binding.path,
          model,
          inputModalities: extras?.inputModalities ?? ["text", "image"],
          ...(apiKey !== undefined ? { apiKey } : {}),
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
          ...wire,
          ...(cacheKey ? { promptCacheKey: cacheKey } : {}),
        });
      }

      if (binding.protocol === "gemini-generate") {
        const wire = sharedAdapterWire(binding, extras);
        return createGeminiAdapter({
          id,
          baseUrl: binding.baseUrl,
          model,
          inputModalities: extras?.inputModalities ?? ["text", "image"],
          ...(apiKey !== undefined ? { apiKey } : {}),
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
          ...wire,
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
