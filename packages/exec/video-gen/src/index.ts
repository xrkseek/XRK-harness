import { createDeepInfraVideoGenProvider } from "./deepinfra-http.js";
import { createFalVideoGenProvider } from "./fal-http.js";
import { createMemoryVideoGenProvider } from "./memory.js";
import { createOpenAiVideoGenProvider } from "./openai-http.js";
import { createOpenRouterVideoGenProvider } from "./openrouter-http.js";
import { createXaiVideoGenProvider } from "./xai-http.js";
import type { VideoGenService } from "./types.js";
import { videoGenUnavailableMessage } from "./tools.js";

export {
  VideoGenError,
  VIDEO_GEN_CAPABILITIES_TEXT_ONLY,
  isTerminalStatus,
  isVideoGenError,
  resolveVideoGenCapabilities,
  videoGenSupportsI2v,
  type VideoGenCapabilities,
  type VideoGenContent,
  type VideoGenCreateKind,
  type VideoGenDelivery,
  type VideoGenErrorCode,
  type VideoGenFamilyEntry,
  type VideoGenJob,
  type VideoGenRequest,
  type VideoGenSeconds,
  type VideoGenService,
  type VideoGenSize,
  type VideoGenSourceImage,
  type VideoGenStatus,
} from "./types.js";
export {
  DEEPINFRA_VIDEO_GEN_CAPABILITIES,
  FAL_VIDEO_GEN_CAPABILITIES,
  FAL_VIDEO_GEN_FAMILIES,
  MEMORY_VIDEO_GEN_CAPABILITIES,
  OPENAI_VIDEO_GEN_CAPABILITIES,
  OPENAI_VIDEO_GEN_FAMILIES,
  OPENROUTER_VIDEO_GEN_CAPABILITIES,
  OPENROUTER_VIDEO_GEN_FAMILIES,
  VIDEO_GEN_SECONDS,
  VIDEO_GEN_SIZES,
  XAI_VIDEO_GEN_CAPABILITIES,
  formatVideoGenCatalog,
} from "./catalog.js";
export {
  buildVideoGenToolDescription,
  buildVideoGenToolParameters,
  videoGenActionsForCapabilities,
} from "./schema.js";
export {
  resolveVideoGenReferenceImages,
  type ResolveVideoGenReferencesOptions,
} from "./references.js";
export { VIDEO_GEN_PROMPT_TEXT } from "./format.js";
export {
  createMemoryVideoGenProvider,
  minimalMp4Bytes,
  type MemoryVideoGenOptions,
} from "./memory.js";
export {
  createOpenAiVideoGenProvider,
  type OpenAiVideoGenOptions,
} from "./openai-http.js";
export {
  createFalVideoGenProvider,
  type FalVideoGenOptions,
} from "./fal-http.js";
export {
  createXaiVideoGenProvider,
  type XaiVideoGenOptions,
} from "./xai-http.js";
export {
  createOpenRouterVideoGenProvider,
  type OpenRouterVideoGenOptions,
} from "./openrouter-http.js";
export {
  createDeepInfraVideoGenProvider,
  type DeepInfraVideoGenOptions,
} from "./deepinfra-http.js";
export {
  createVideoGenTools,
  videoGenUnavailableMessage,
  type CreateVideoGenToolsOptions,
} from "./tools.js";

/** Face `video-gen` product modes (Settings SoT). `memory` stays env-only. */
export const VIDEO_GEN_PRODUCT_MODES = [
  "off",
  "openai",
  "fal",
  "xai",
  "openrouter",
  "deepinfra",
] as const;

export type VideoGenProductMode = (typeof VIDEO_GEN_PRODUCT_MODES)[number];

/** Face `video-gen` product shape. */
export interface VideoGenProductConfig {
  readonly mode: VideoGenProductMode;
  readonly baseUrl?: string;
  readonly model?: string;
}

export interface DefaultVideoGenAccessOptions {
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Face Settings product. Used when `XRK_VIDEO_GEN` is unset
   * (env remains the CI bypass).
   */
  readonly product?: VideoGenProductConfig;
  readonly service?: VideoGenService;
  readonly fetchImpl?: typeof fetch;
}

export interface DefaultVideoGenAccess {
  readonly service?: VideoGenService;
  readonly unavailableMessage: string;
}

function resolveOpenAiKey(env: NodeJS.ProcessEnv): string | undefined {
  const a = String(env.XRK_VIDEO_GEN_OPENAI_KEY ?? "").trim();
  if (a) return a;
  const b = String(env.OPENAI_API_KEY ?? "").trim();
  return b || undefined;
}

function resolveFalKey(env: NodeJS.ProcessEnv): string | undefined {
  const a = String(env.XRK_VIDEO_GEN_FAL_KEY ?? "").trim();
  if (a) return a;
  const b = String(env.FAL_KEY ?? "").trim();
  return b || undefined;
}

function resolveXaiKey(env: NodeJS.ProcessEnv): string | undefined {
  const a = String(env.XRK_VIDEO_GEN_XAI_KEY ?? "").trim();
  if (a) return a;
  const b = String(env.XAI_API_KEY ?? "").trim();
  return b || undefined;
}

function resolveOpenRouterKey(env: NodeJS.ProcessEnv): string | undefined {
  const a = String(env.XRK_VIDEO_GEN_OPENROUTER_KEY ?? "").trim();
  if (a) return a;
  const b = String(env.OPENROUTER_API_KEY ?? "").trim();
  return b || undefined;
}

function resolveDeepInfraKey(env: NodeJS.ProcessEnv): string | undefined {
  const a = String(env.XRK_VIDEO_GEN_DEEPINFRA_KEY ?? "").trim();
  if (a) return a;
  const b = String(env.DEEPINFRA_API_KEY ?? "").trim();
  return b || undefined;
}

function productModeFlag(
  product: VideoGenProductConfig | undefined,
): string {
  const m = product?.mode;
  if (m && m !== "off" && (VIDEO_GEN_PRODUCT_MODES as readonly string[]).includes(m)) {
    return m;
  }
  return "";
}

/**
 * Resolve a text-to-video / i2v Provider.
 * Hermes main-path matrix: openai · fal · xai · openrouter · deepinfra (+ memory env).
 */
export function createDefaultVideoGenAccess(
  options: DefaultVideoGenAccessOptions = {},
): DefaultVideoGenAccess {
  const env = options.env ?? process.env;
  const unavailableMessage = videoGenUnavailableMessage(env, options.product);
  if (options.service) {
    return { service: options.service, unavailableMessage };
  }
  const envRaw = String(env.XRK_VIDEO_GEN ?? "").trim();
  const flag =
    envRaw !== "" ? envRaw.toLowerCase() : productModeFlag(options.product);
  if (flag === "memory") {
    return {
      service: createMemoryVideoGenProvider(),
      unavailableMessage,
    };
  }
  const baseUrl =
    options.product?.baseUrl?.trim() ||
    String(env.XRK_VIDEO_GEN_BASE_URL ?? "").trim();
  const model =
    options.product?.model?.trim() ||
    String(env.XRK_VIDEO_GEN_MODEL ?? "").trim();
  const fetchOpts = options.fetchImpl
    ? { fetchImpl: options.fetchImpl }
    : {};

  if (flag === "1" || flag === "openai") {
    const apiKey = resolveOpenAiKey(env);
    if (!apiKey) return { unavailableMessage };
    return {
      service: createOpenAiVideoGenProvider({
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
      service: createFalVideoGenProvider({
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
      service: createXaiVideoGenProvider({
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
      service: createOpenRouterVideoGenProvider({
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
      service: createDeepInfraVideoGenProvider({
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
