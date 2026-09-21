import { createMemoryVideoGenProvider } from "./memory.js";
import { createOpenAiVideoGenProvider } from "./openai-http.js";
import type { VideoGenService } from "./types.js";
import { videoGenUnavailableMessage } from "./tools.js";

export {
  VideoGenError,
  isTerminalStatus,
  isVideoGenError,
  type VideoGenContent,
  type VideoGenDelivery,
  type VideoGenErrorCode,
  type VideoGenJob,
  type VideoGenRequest,
  type VideoGenSeconds,
  type VideoGenService,
  type VideoGenSize,
  type VideoGenStatus,
} from "./types.js";
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

export interface DefaultVideoGenAccessOptions {
  readonly env?: NodeJS.ProcessEnv;
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
 * Resolve a text-to-video Provider.
 * - Injected `service` wins.
 * - `XRK_VIDEO_GEN=memory` → in-memory Provider.
 * - `XRK_VIDEO_GEN=1` + API key → OpenAI Videos API (Sora).
 * - Else no service; tools stay registered and fail honestly.
 */
export function createDefaultVideoGenAccess(
  options: DefaultVideoGenAccessOptions = {},
): DefaultVideoGenAccess {
  const env = options.env ?? process.env;
  const unavailableMessage = videoGenUnavailableMessage(env);
  if (options.service) {
    return { service: options.service, unavailableMessage };
  }
  const flag = String(env.XRK_VIDEO_GEN ?? "")
    .trim()
    .toLowerCase();
  if (flag === "memory") {
    return {
      service: createMemoryVideoGenProvider(),
      unavailableMessage,
    };
  }
  if (flag === "1") {
    const apiKey = resolveApiKey(env);
    if (!apiKey) {
      return { unavailableMessage };
    }
    const baseUrl = String(env.XRK_VIDEO_GEN_BASE_URL ?? "").trim();
    const model = String(env.XRK_VIDEO_GEN_MODEL ?? "").trim();
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
