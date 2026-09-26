/**
 * DeepInfra OpenAI-compatible Videos (Hermes video_gen/deepinfra).
 */
import { createOpenAiVideoGenProvider } from "./openai-http.js";
import { DEEPINFRA_VIDEO_GEN_CAPABILITIES } from "./catalog.js";
import type { VideoGenService } from "./types.js";

export interface DeepInfraVideoGenOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly model?: string;
}

export function createDeepInfraVideoGenProvider(
  options: DeepInfraVideoGenOptions,
): VideoGenService {
  return createOpenAiVideoGenProvider({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl ?? "https://api.deepinfra.com/v1/openai",
    model: options.model ?? "Wan-AI/Wan2.1-T2V-14B",
    capabilities: DEEPINFRA_VIDEO_GEN_CAPABILITIES,
    delivery: "deepinfra",
    providerName: "deepinfra",
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}
