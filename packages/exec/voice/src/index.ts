import { createMemoryVoiceProvider } from "./memory.js";
import { createOpenAiVoiceProvider } from "./openai-http.js";
import { createSenseVoiceLocalProvider } from "./sensevoice-local.js";
import type { VoiceService } from "./types.js";
import { voiceUnavailableMessage } from "./readiness.js";

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
  createSenseVoiceLocalProvider,
  inspectSenseVoiceAssets,
  senseVoiceDataRoot,
  type SenseVoiceInspectResult,
  type SenseVoiceLocalOptions,
} from "./sensevoice-local.js";
export {
  createVoiceTools,
  createSpeakTool,
  describeVoiceAccess,
  voiceUnavailableMessage,
  type CreateVoiceToolsOptions,
  type VoiceAccessDescription,
  type VoiceAccessKind,
} from "./tools.js";

/** Face `voice` product modes (Settings SoT). `memory` stays env-only. */
export type VoiceProductMode = "off" | "openai" | "local";

/** Face `voice` product shape. */
export interface VoiceProductConfig {
  readonly mode: VoiceProductMode;
  /** Optional OpenAI-compatible base URL. */
  readonly baseUrl?: string;
}

export interface DefaultVoiceAccessOptions {
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Face Settings product. Used when `XRK_VOICE` is unset
   * (env remains the CI bypass).
   */
  readonly product?: VoiceProductConfig;
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
 * - Non-empty `XRK_VOICE` is CI bypass over Face `product`.
 * - Product / env: `off` · `openai` (`1`) · `memory` (env-only).
 * - Else no service; tools stay registered and fail honestly.
 */
export function createDefaultVoiceAccess(
  options: DefaultVoiceAccessOptions = {},
): DefaultVoiceAccess {
  const env = options.env ?? process.env;
  const unavailableMessage = voiceUnavailableMessage(env, options.product);
  if (options.service) {
    return { service: options.service, unavailableMessage };
  }
  const envRaw = String(env.XRK_VOICE ?? "").trim();
  const productMode = options.product?.mode;
  const flag =
    envRaw !== ""
      ? envRaw.toLowerCase()
      : productMode === "openai"
        ? "1"
        : productMode === "local"
          ? "local"
          : "";
  if (flag === "memory") {
    return {
      service: createMemoryVoiceProvider(),
      unavailableMessage,
    };
  }
  if (flag === "local" || flag === "sensevoice") {
    return {
      service: createSenseVoiceLocalProvider({ env }),
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
      String(env.XRK_VOICE_BASE_URL ?? "").trim();
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
