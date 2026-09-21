import { createMemoryVoiceProvider } from "./memory.js";
import { createOpenAiVoiceProvider } from "./openai-http.js";
import type { VoiceService } from "./types.js";
import { voiceUnavailableMessage } from "./tools.js";

export {
  VoiceError,
  isVoiceError,
  type VoiceDelivery,
  type VoiceErrorCode,
  type VoiceLiveCreateRequest,
  type VoiceLiveCreateResult,
  type VoiceLiveStatus,
  type VoiceService,
  type VoiceSynthesizeRequest,
  type VoiceSynthesizeResult,
  type VoiceTranscribeRequest,
  type VoiceTranscribeResult,
} from "./types.js";
export { VOICE_PROMPT_TEXT } from "./format.js";
export {
  createMemoryVoiceProvider,
  minimalWavBytes,
  type MemoryVoiceOptions,
} from "./memory.js";
export {
  createOpenAiVoiceProvider,
  type OpenAiVoiceOptions,
} from "./openai-http.js";
export {
  createVoiceTools,
  voiceUnavailableMessage,
  type CreateVoiceToolsOptions,
} from "./tools.js";

export interface DefaultVoiceAccessOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly service?: VoiceService;
  readonly fetchImpl?: typeof fetch;
}

export interface DefaultVoiceAccess {
  readonly service?: VoiceService;
  readonly unavailableMessage: string;
}

function resolveApiKey(env: NodeJS.ProcessEnv): string | undefined {
  const a = String(env.XRK_VOICE_OPENAI_KEY ?? "").trim();
  if (a) return a;
  const b = String(env.OPENAI_API_KEY ?? "").trim();
  return b || undefined;
}

/**
 * Resolve a voice Provider.
 * - Injected `service` wins.
 * - `XRK_VOICE=memory` → in-memory Provider.
 * - `XRK_VOICE=1` + API key → OpenAI-compatible TTS/STT/realtime.
 * - Else no service; tools stay registered and fail honestly.
 */
export function createDefaultVoiceAccess(
  options: DefaultVoiceAccessOptions = {},
): DefaultVoiceAccess {
  const env = options.env ?? process.env;
  const unavailableMessage = voiceUnavailableMessage(env);
  if (options.service) {
    return { service: options.service, unavailableMessage };
  }
  const flag = String(env.XRK_VOICE ?? "").trim().toLowerCase();
  if (flag === "memory") {
    return {
      service: createMemoryVoiceProvider(),
      unavailableMessage,
    };
  }
  if (flag === "1") {
    const apiKey = resolveApiKey(env);
    if (!apiKey) {
      return { unavailableMessage };
    }
    const baseUrl = String(env.XRK_VOICE_BASE_URL ?? "").trim();
    return {
      service: createOpenAiVoiceProvider({
        apiKey,
        ...(baseUrl ? { baseUrl } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      }),
      unavailableMessage,
    };
  }
  return { unavailableMessage };
}
