import { createMemoryVideoGenProvider } from "./memory.js";
import { createOpenAiVideoGenProvider } from "./openai-http.js";
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
  MEMORY_VIDEO_GEN_CAPABILITIES,
  OPENAI_VIDEO_GEN_CAPABILITIES,
  OPENAI_VIDEO_GEN_FAMILIES,
  VIDEO_GEN_SECONDS,
  VIDEO_GEN_SIZES,
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
  createVideoGenTools,
  videoGenUnavailableMessage,
  type CreateVideoGenToolsOptions,
} from "./tools.js";

/** Face `video-gen` product modes (Settings SoT). `memory` stays env-only. */
export type VideoGenProductMode = "off" | "openai";

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

function resolveApiKey(env: NodeJS.ProcessEnv): string | undefined {
  const a = String(env.XRK_VIDEO_GEN_OPENAI_KEY ?? "").trim();
  if (a) return a;
  const b = String(env.OPENAI_API_KEY ?? "").trim();
  return b || undefined;
}

/**
 * Resolve a text-to-video / i2v Provider.
 * - Injected `service` wins.
 * - Non-empty `XRK_VIDEO_GEN` is CI bypass over Face `product`.
 * - Product / env: `off` · `openai` (`1`) · `memory` (env-only).
 * - Else no service; tools stay registered and fail honestly.
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
    envRaw !== ""
      ? envRaw.toLowerCase()
      : options.product?.mode === "openai"
        ? "1"
        : "";
  if (flag === "memory") {
    return {
      service: createMemoryVideoGenProvider(),
      unavailableMessage,
    };
  }
  if (flag === "1" || flag === "openai") {
    const apiKey = resolveApiKey(env);
    if (!apiKey) {
      return { unavailableMessage };
    }
    const baseUrl =
      options.product?.baseUrl?.trim() ||
      String(env.XRK_VIDEO_GEN_BASE_URL ?? "").trim();
    const model =
      options.product?.model?.trim() ||
      String(env.XRK_VIDEO_GEN_MODEL ?? "").trim();
    return {
      service: createOpenAiVideoGenProvider({
        apiKey,
        ...(baseUrl ? { baseUrl } : {}),
        ...(model ? { model } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      }),
      unavailableMessage,
    };
  }
  return { unavailableMessage };
}
