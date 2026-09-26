import { createDeepInfraImageGenProvider } from "./deepinfra-http.js";
import { createFalImageGenProvider } from "./fal-http.js";
import { createKreaImageGenProvider } from "./krea-http.js";
import { createMemoryImageGenProvider } from "./memory.js";
import { createMetaAiImageGenProvider } from "./meta-ai-http.js";
import { createOpenAiImageGenProvider } from "./openai-http.js";
import { createOpenRouterImageGenProvider } from "./openrouter-http.js";
import { createXaiImageGenProvider } from "./xai-http.js";
import type { ImageGenService } from "./types.js";
import { imageGenUnavailableMessage } from "./tools.js";

export {
  ImageGenError,
  IMAGE_GEN_CAPABILITIES_TEXT_ONLY,
  imageGenSupportsEdit,
  isImageGenError,
  resolveImageGenCapabilities,
  type ImageGenCapabilities,
  type ImageGenDelivery,
  type ImageGenErrorCode,
  type ImageGenImage,
  type ImageGenRequest,
  type ImageGenResult,
  type ImageGenService,
  type ImageGenSize,
  type ImageGenSourceImage,
} from "./types.js";
export {
  FAL_IMAGE_DEFAULT_MODEL,
  FAL_IMAGE_MODELS,
  resolveFalImageModel,
  type FalImageModelEntry,
} from "./catalog.js";
export { IMAGE_GEN_PROMPT_TEXT } from "./format.js";
export {
  createMemoryImageGenProvider,
  minimalPngBytes,
  type MemoryImageGenOptions,
} from "./memory.js";
export {
  createOpenAiImageGenProvider,
  type OpenAiImageGenOptions,
} from "./openai-http.js";
export {
  createFalImageGenProvider,
  type FalImageGenOptions,
} from "./fal-http.js";
export {
  createXaiImageGenProvider,
  type XaiImageGenOptions,
} from "./xai-http.js";
export {
  createOpenRouterImageGenProvider,
  type OpenRouterImageGenOptions,
} from "./openrouter-http.js";
export {
  createDeepInfraImageGenProvider,
  type DeepInfraImageGenOptions,
} from "./deepinfra-http.js";
export {
  createKreaImageGenProvider,
  type KreaImageGenOptions,
} from "./krea-http.js";
export {
  createMetaAiImageGenProvider,
  type MetaAiImageGenOptions,
} from "./meta-ai-http.js";
export {
  createImageGenTools,
  imageGenUnavailableMessage,
  type CreateImageGenToolsOptions,
} from "./tools.js";
export {
  buildImageGenToolDescription,
  buildImageGenToolParameters,
  IMAGE_GEN_SIZES,
} from "./schema.js";
export { resolveImageGenReferenceImages } from "./references.js";

/** Face `image-gen` product modes (Settings SoT). `memory` stays env-only. */
export const IMAGE_GEN_PRODUCT_MODES = [
  "off",
  "openai",
  "fal",
  "xai",
  "openrouter",
  "deepinfra",
  "krea",
  "meta-ai",
] as const;

export type ImageGenProductMode = (typeof IMAGE_GEN_PRODUCT_MODES)[number];

/** Face `image-gen` product shape. */
export interface ImageGenProductConfig {
  readonly mode: ImageGenProductMode;
  readonly baseUrl?: string;
  readonly model?: string;
}

export interface DefaultImageGenAccessOptions {
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Face Settings product. Used when `XRK_IMAGE_GEN` is unset
   * (env remains the CI bypass).
   */
  readonly product?: ImageGenProductConfig;
  readonly service?: ImageGenService;
  readonly fetchImpl?: typeof fetch;
}

export interface DefaultImageGenAccess {
  readonly service?: ImageGenService;
  readonly unavailableMessage: string;
}

function resolveOpenAiKey(env: NodeJS.ProcessEnv): string | undefined {
  const a = String(env.XRK_IMAGE_GEN_OPENAI_KEY ?? "").trim();
  if (a) return a;
  const b = String(env.OPENAI_API_KEY ?? "").trim();
  return b || undefined;
}

function resolveFalKey(env: NodeJS.ProcessEnv): string | undefined {
  const a = String(env.XRK_IMAGE_GEN_FAL_KEY ?? "").trim();
  if (a) return a;
  const b = String(env.FAL_KEY ?? "").trim();
  return b || undefined;
}

function resolveXaiKey(env: NodeJS.ProcessEnv): string | undefined {
  const a = String(env.XRK_IMAGE_GEN_XAI_KEY ?? "").trim();
  if (a) return a;
  const b = String(env.XAI_API_KEY ?? "").trim();
  return b || undefined;
}

function resolveOpenRouterKey(env: NodeJS.ProcessEnv): string | undefined {
  const a = String(env.XRK_IMAGE_GEN_OPENROUTER_KEY ?? "").trim();
  if (a) return a;
  const b = String(env.OPENROUTER_API_KEY ?? "").trim();
  return b || undefined;
}

function resolveDeepInfraKey(env: NodeJS.ProcessEnv): string | undefined {
  const a = String(env.XRK_IMAGE_GEN_DEEPINFRA_KEY ?? "").trim();
  if (a) return a;
  const b = String(env.DEEPINFRA_API_KEY ?? "").trim();
  return b || undefined;
}

function resolveKreaKey(env: NodeJS.ProcessEnv): string | undefined {
  const a = String(env.XRK_IMAGE_GEN_KREA_KEY ?? "").trim();
  if (a) return a;
  const b = String(env.KREA_API_KEY ?? "").trim();
  return b || undefined;
}

function resolveMetaAiKey(env: NodeJS.ProcessEnv): string | undefined {
  const a = String(env.XRK_IMAGE_GEN_META_KEY ?? "").trim();
  if (a) return a;
  for (const name of ["META_MODEL_API_KEY", "META_API_KEY", "MODEL_API_KEY"] as const) {
    const v = String(env[name] ?? "").trim();
    if (v) return v;
  }
  return undefined;
}

function productModeFlag(
  product: ImageGenProductConfig | undefined,
): string {
  const m = product?.mode;
  if (m && m !== "off" && (IMAGE_GEN_PRODUCT_MODES as readonly string[]).includes(m)) {
    return m;
  }
  return "";
}

/**
 * Resolve an image Provider (t2i + edit when capabilities allow).
 * Hermes main-path matrix: openai · fal · xai · openrouter · deepinfra · krea · meta-ai (+ memory env).
 */
export function createDefaultImageGenAccess(
  options: DefaultImageGenAccessOptions = {},
): DefaultImageGenAccess {
  const env = options.env ?? process.env;
  const unavailableMessage = imageGenUnavailableMessage(env, options.product);
  if (options.service) {
    return { service: options.service, unavailableMessage };
  }
  const envRaw = String(env.XRK_IMAGE_GEN ?? "").trim();
  const flag =
    envRaw !== "" ? envRaw.toLowerCase() : productModeFlag(options.product);
  if (flag === "memory") {
    return {
      service: createMemoryImageGenProvider(),
      unavailableMessage,
    };
  }
  const baseUrl =
    options.product?.baseUrl?.trim() ||
    String(env.XRK_IMAGE_GEN_BASE_URL ?? "").trim();
  const model =
    options.product?.model?.trim() ||
    String(env.XRK_IMAGE_GEN_MODEL ?? "").trim();
  const fetchOpts = options.fetchImpl
    ? { fetchImpl: options.fetchImpl }
    : {};

  if (flag === "1" || flag === "openai") {
    const apiKey = resolveOpenAiKey(env);
    if (!apiKey) return { unavailableMessage };
    return {
      service: createOpenAiImageGenProvider({
        apiKey,
        ...(baseUrl ? { baseUrl } : {}),
        ...(model ? { model } : {}),
        ...fetchOpts,
      }),
      unavailableMessage,
    };
  }
  if (flag === "fal") {
    const apiKey = resolveFalKey(env);
    if (!apiKey) return { unavailableMessage };
    return {
      service: createFalImageGenProvider({
        apiKey,
        ...(baseUrl ? { baseUrl } : {}),
        ...(model ? { model } : {}),
        ...fetchOpts,
      }),
      unavailableMessage,
    };
  }
  if (flag === "xai") {
    const apiKey = resolveXaiKey(env);
    if (!apiKey) return { unavailableMessage };
    return {
      service: createXaiImageGenProvider({
        apiKey,
        ...(baseUrl ? { baseUrl } : {}),
        ...(model ? { model } : {}),
        ...fetchOpts,
      }),
      unavailableMessage,
    };
  }
  if (flag === "openrouter") {
    const apiKey = resolveOpenRouterKey(env);
    if (!apiKey) return { unavailableMessage };
    return {
      service: createOpenRouterImageGenProvider({
        apiKey,
        ...(baseUrl ? { baseUrl } : {}),
        ...(model ? { model } : {}),
        ...fetchOpts,
      }),
      unavailableMessage,
    };
  }
  if (flag === "deepinfra") {
    const apiKey = resolveDeepInfraKey(env);
    if (!apiKey) return { unavailableMessage };
    return {
      service: createDeepInfraImageGenProvider({
        apiKey,
        ...(baseUrl ? { baseUrl } : {}),
        ...(model ? { model } : {}),
        ...fetchOpts,
      }),
      unavailableMessage,
    };
  }
  if (flag === "krea") {
    const apiKey = resolveKreaKey(env);
    if (!apiKey) return { unavailableMessage };
    return {
      service: createKreaImageGenProvider({
        apiKey,
        ...(baseUrl ? { baseUrl } : {}),
        ...(model ? { model } : {}),
        ...fetchOpts,
      }),
      unavailableMessage,
    };
  }
  if (flag === "meta-ai" || flag === "meta") {
    const apiKey = resolveMetaAiKey(env);
    if (!apiKey) return { unavailableMessage };
    return {
      service: createMetaAiImageGenProvider({
        apiKey,
        ...(baseUrl ? { baseUrl } : {}),
        ...(model ? { model } : {}),
        ...fetchOpts,
      }),
      unavailableMessage,
    };
  }
  return { unavailableMessage };
}
