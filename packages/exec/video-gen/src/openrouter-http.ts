/**
 * OpenRouter Videos API — async create → poll → content (Hermes video_gen/openrouter).
 * Shape mirrors OpenAI Videos; catalog seed is offline with live models optional later.
 */
import { createOpenAiVideoGenProvider } from "./openai-http.js";
import { OPENROUTER_VIDEO_GEN_CAPABILITIES } from "./catalog.js";
import type { VideoGenService } from "./types.js";

export interface OpenRouterVideoGenOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly model?: string;
}

export function createOpenRouterVideoGenProvider(
  options: OpenRouterVideoGenOptions,
): VideoGenService {
  return createOpenAiVideoGenProvider({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl ?? "https://openrouter.ai/api/v1",
    model: options.model ?? "minimax/hailuo-3-max",
    capabilities: OPENROUTER_VIDEO_GEN_CAPABILITIES,
    delivery: "openrouter",
    providerName: "openrouter",
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}
