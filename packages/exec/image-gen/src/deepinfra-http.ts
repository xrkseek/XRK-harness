/**
 * DeepInfra OpenAI-compatible image Provider (Hermes: text-to-image only).
 * Reuses the OpenAI Images client against `api.deepinfra.com/v1/openai`.
 */
import { createOpenAiImageGenProvider } from "./openai-http.js";
import type { ImageGenCapabilities, ImageGenService } from "./types.js";

export interface DeepInfraImageGenOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly model?: string;
}

const TEXT_ONLY: ImageGenCapabilities = {
  modalities: ["text"],
  maxReferenceImages: 0,
};

export function createDeepInfraImageGenProvider(
  options: DeepInfraImageGenOptions,
): ImageGenService {
  return createOpenAiImageGenProvider({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl ?? "https://api.deepinfra.com/v1/openai",
    model: options.model ?? "black-forest-labs/FLUX-1-schnell",
    capabilities: TEXT_ONLY,
    delivery: "deepinfra",
    providerName: "deepinfra",
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}
