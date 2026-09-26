/**
 * Meta Model API Muse Image (Hermes meta-ai) — OpenAI-compatible `/images/generations`.
 * Text-to-image only until Meta i2i is verified.
 */
import { createOpenAiImageGenProvider } from "./openai-http.js";
import type { ImageGenCapabilities, ImageGenService } from "./types.js";

export interface MetaAiImageGenOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly model?: string;
}

const TEXT_ONLY: ImageGenCapabilities = {
  modalities: ["text"],
  maxReferenceImages: 0,
};

export function createMetaAiImageGenProvider(
  options: MetaAiImageGenOptions,
): ImageGenService {
  return createOpenAiImageGenProvider({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl ?? "https://api.meta.ai/v1",
    model: options.model ?? "muse-image-1.0",
    capabilities: TEXT_ONLY,
    delivery: "meta-ai",
    providerName: "meta-ai",
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}
