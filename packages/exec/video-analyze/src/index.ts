import { createMemoryVideoAnalyzeProvider } from "./memory.js";
import { createOpenAiVideoAnalyzeProvider } from "./openai-http.js";
import type { VideoAnalyzeService } from "./types.js";
import { videoAnalyzeUnavailableMessage } from "./tools.js";

export {
  VideoAnalyzeError,
  isVideoAnalyzeError,
  type VideoAnalyzeErrorCode,
  type VideoAnalyzeRequest,
  type VideoAnalyzeResult,
  type VideoAnalyzeService,
  type VideoMediaType,
} from "./types.js";
export {
  MAX_VIDEO_BYTES,
  VIDEO_MIME_BY_EXT,
  VIDEO_SIZE_WARN_BYTES,
  assertVideoByteBudget,
  unsupportedVideoFormatMessage,
  videoMimeForPath,
  wrapVideoAnalyzePrompt,
} from "./mime.js";
export {
  materializeVideo,
  type MaterializedVideo,
  type VideoAnalyzeFs,
} from "./materialize.js";
export { VIDEO_ANALYZE_PROMPT_TEXT } from "./format.js";
export {
  createMemoryVideoAnalyzeProvider,
  type MemoryVideoAnalyzeOptions,
} from "./memory.js";
export {
  createOpenAiVideoAnalyzeProvider,
  type OpenAiVideoAnalyzeOptions,
} from "./openai-http.js";
export {
  createVideoAnalyzeTools,
  videoAnalyzeUnavailableMessage,
  type CreateVideoAnalyzeToolsOptions,
} from "./tools.js";

/** Face `video-analyze` product modes (Settings SoT). `memory` stays env-only. */
export type VideoAnalyzeProductMode = "off" | "openai";

/** Face `video-analyze` product shape. */
export interface VideoAnalyzeProductConfig {
  readonly mode: VideoAnalyzeProductMode;
  readonly baseUrl?: string;
  readonly model?: string;
}

export interface DefaultVideoAnalyzeAccessOptions {
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Face Settings product. Used when `XRK_VIDEO_ANALYZE` is unset
   * (env remains the CI bypass).
   */
  readonly product?: VideoAnalyzeProductConfig;
  readonly service?: VideoAnalyzeService;
  readonly fetchImpl?: typeof fetch;
}

export interface DefaultVideoAnalyzeAccess {
  readonly service?: VideoAnalyzeService;
  readonly unavailableMessage: string;
}

function resolveApiKey(env: NodeJS.ProcessEnv): string | undefined {
  const a = String(env.XRK_VIDEO_ANALYZE_OPENAI_KEY ?? "").trim();
  if (a) return a;
  const b = String(env.OPENAI_API_KEY ?? "").trim();
  return b || undefined;
}

/**
 * Resolve a video-analyze Provider.
 * - Injected `service` wins.
 * - Non-empty `XRK_VIDEO_ANALYZE` is CI bypass over Face `product`.
 * - Product / env: `off` · `openai` (`1`) · `memory` (env-only).
 * - Else no service; tools stay registered and fail honestly.
 */
export function createDefaultVideoAnalyzeAccess(
  options: DefaultVideoAnalyzeAccessOptions = {},
): DefaultVideoAnalyzeAccess {
  const env = options.env ?? process.env;
  const unavailableMessage = videoAnalyzeUnavailableMessage(env, options.product);
  if (options.service) {
    return { service: options.service, unavailableMessage };
  }
  const envRaw = String(env.XRK_VIDEO_ANALYZE ?? "").trim();
  const flag =
    envRaw !== ""
      ? envRaw.toLowerCase()
      : options.product?.mode === "openai"
        ? "1"
        : "";
  if (flag === "memory") {
    return {
      service: createMemoryVideoAnalyzeProvider(),
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
      String(env.XRK_VIDEO_ANALYZE_BASE_URL ?? "").trim();
    const model =
      options.product?.model?.trim() ||
      String(env.XRK_VIDEO_ANALYZE_MODEL ?? "").trim();
    return {
      service: createOpenAiVideoAnalyzeProvider({
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
