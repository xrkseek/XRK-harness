/**
 * Voice Host seam: engine registry + Provider contracts + tools.
 *
 * One entry point builds a Provider — {@link createVoiceAccess} — and the Host,
 * the Face handler and the cards all go through it. Adding a Provider is one
 * row in `engines.ts` plus the settings enum; nothing else grows an engine
 * branch.
 */

export {
  VoiceError,
  isVoiceError,
  type VoiceDelivery,
  type VoiceDirection,
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
export { resolveEngineId } from "./engine-ids.js";
export {
  createVoiceAccess,
  listVoiceEngines,
  type VoiceAccess,
  type VoiceAccessRequest,
  type VoiceEngineContext,
  type VoiceEngineSpec,
} from "./engines.js";
export {
  createVoiceTools,
  createSpeakTool,
  describeVoiceAccess,
  voiceUnavailableMessage,
  type CreateVoiceToolsOptions,
  type VoiceAccessDescription,
  type VoiceAccessFacts,
  type VoiceAccessKind,
} from "./tools.js";
export {
  VOICE_ASR_PROMPT_TEXT,
  VOICE_PROMPT_TEXT,
  VOICE_TTS_PROMPT_TEXT,
  voicePromptText,
} from "./format.js";
export {
  createEdgeVoiceProvider,
  EDGE_DEFAULT_VOICE,
  filterEdgeVoices,
  listEdgeVoices,
  type EdgeTtsOptions,
  type EdgeVoice,
  type EdgeVoiceProviderOptions,
} from "./edge-tts.js";
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
  probeSenseVoiceEngine,
  senseVoiceDataRoot,
  SENSEVOICE_PLATFORMS,
  type SenseVoiceEngineProbe,
  type SenseVoiceInspectResult,
  type SenseVoiceLocalOptions,
} from "./sensevoice-local.js";
export {
  createSystemVoiceProvider,
  listSystemVoices,
  type SystemVoice,
  type SystemVoiceOptions,
} from "./system-tts.js";
export {
  SENSEVOICE_ASSETS,
  SENSEVOICE_ORIGINS,
  SENSEVOICE_TOTAL_BYTES,
  type SenseVoiceAsset,
} from "./sensevoice-assets.js";
export {
  SenseVoicePreparer,
  senseVoicePreparer,
  type SenseVoicePrepareErrorCode,
  type SenseVoicePrepareFailure,
  type SenseVoicePreparePhase,
  type SenseVoicePreparerOptions,
  type SenseVoicePrepareState,
} from "./sensevoice-runtime.js";
export {
  openAssetStream,
  parseProxy,
  type DownloadStream,
  type ProxyParseResult,
  type ProxyTarget,
} from "./download-http.js";

/**
 * Host-side snapshot of the ASR product carried with agent settings.
 * Shape only — `createVoiceAccess` reads the live Settings namespace instead.
 */
export interface VoiceProductConfig {
  readonly mode: "off" | "openai" | "local" | "system";
  /** Optional OpenAI-compatible base URL. */
  readonly baseUrl?: string;
}
