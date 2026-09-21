import { createMemoryImageGenProvider } from "./memory.js";
import { createOpenAiImageGenProvider } from "./openai-http.js";
import type { ImageGenService } from "./types.js";
import { imageGenUnavailableMessage } from "./tools.js";

export {
  ImageGenError,
  isImageGenError,
  type ImageGenDelivery,
  type ImageGenErrorCode,
  type ImageGenImage,
  type ImageGenRequest,
  type ImageGenResult,
  type ImageGenService,
  type ImageGenSize,
} from "./types.js";
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
  createImageGenTools,
  imageGenUnavailableMessage,
  type CreateImageGenToolsOptions,
} from "./tools.js";

export interface DefaultImageGenAccessOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly service?: ImageGenService;
  readonly fetchImpl?: typeof fetch;
}

export interface DefaultImageGenAccess {
  readonly service?: ImageGenService;
  readonly unavailableMessage: string;
}

function resolveApiKey(env: NodeJS.ProcessEnv): string | undefined {
  const a = String(env.XRK_IMAGE_GEN_OPENAI_KEY ?? "").trim();
  if (a) return a;
  const b = String(env.OPENAI_API_KEY ?? "").trim();
  return b || undefined;
}

/**
 * Resolve a text-to-image Provider.
 * - Injected `service` wins.
 * - `XRK_IMAGE_GEN=memory` → in-memory Provider.
 * - `XRK_IMAGE_GEN=1` + API key → OpenAI Images API.
 * - Else no service; tools stay registered and fail honestly.
 */
export function createDefaultImageGenAccess(
  options: DefaultImageGenAccessOptions = {},
): DefaultImageGenAccess {
  const env = options.env ?? process.env;
  const unavailableMessage = imageGenUnavailableMessage(env);
  if (options.service) {
    return { service: options.service, unavailableMessage };
  }
  const flag = String(env.XRK_IMAGE_GEN ?? "").trim().toLowerCase();
  if (flag === "memory") {
    return {
      service: createMemoryImageGenProvider(),
      unavailableMessage,
    };
  }
  if (flag === "1") {
    const apiKey = resolveApiKey(env);
    if (!apiKey) {
      return { unavailableMessage };
    }
    const baseUrl = String(env.XRK_IMAGE_GEN_BASE_URL ?? "").trim();
    const model = String(env.XRK_IMAGE_GEN_MODEL ?? "").trim();
    return {
      service: createOpenAiImageGenProvider({
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
