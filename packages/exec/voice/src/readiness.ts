/**
 * Shared Voice readiness facts for Settings UI, doctor, and tool error text.
 * Wake-word / always-on hotword is intentionally out of scope (see docs/voice.md).
 */

import { resolveEngineId } from "./engine-ids.js";
import type { VoiceDirection } from "./types.js";

export type VoiceAccessKind =
  | "off"
  | "memory"
  | "local"
  | "system"
  | "openai-ready"
  | "openai-missing-key"
  | "unknown";

/** What a caller knows about the Settings side of voice. */
export interface VoiceAccessFacts {
  readonly direction: VoiceDirection;
  /** Engine id staged by the card (`local` / `openai`). */
  readonly engine?: string;
}

export interface VoiceAccessDescription {
  readonly kind: VoiceAccessKind;
  /** True when a VoiceService Provider can be constructed without inject. */
  readonly ready: boolean;
  /** Tool-facing `Error: …` line (same wording for UI / doctor / tools). */
  readonly message: string;
  /** Short one-line for `xrkh doctor` / Settings status. */
  readonly summary: string;
}

function hasApiKey(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    String(env.XRK_VOICE_OPENAI_KEY ?? "").trim() ||
      String(env.OPENAI_API_KEY ?? "").trim(),
  );
}

/**
 * Describe how Voice would resolve for this env + Settings engine.
 * Does not construct Providers — only readiness / honest-failure copy.
 * @param env - environment carrying the CI bypass and keys.
 * @param facts - direction and the engine Settings selected.
 * @returns the readiness facts tools and Settings share.
 */
export function describeVoiceAccess(
  env: NodeJS.ProcessEnv,
  facts: VoiceAccessFacts,
): VoiceAccessDescription {
  const engine = resolveEngineId(env, facts.engine);
  const asr = facts.direction === "asr";
  if (engine === "") {
    return {
      kind: "off",
      ready: false,
      message: asr
        ? "Error: speech input is not enabled. Turn on Settings → Plugins → ASR, or set " +
          "XRK_VOICE=local (SenseVoice) / XRK_VOICE=1 with XRK_VOICE_OPENAI_KEY. See docs/voice.md."
        : "Error: text-to-speech is not enabled. Turn on Settings → Plugins → TTS, or set " +
          "XRK_VOICE=system / XRK_VOICE=1 with XRK_VOICE_OPENAI_KEY. See docs/voice.md.",
      summary: asr
        ? "ASR off — dictation has no Provider"
        : "TTS off — the speak tool has no Provider",
    };
  }
  if (engine === "memory") {
    return {
      kind: "memory",
      ready: true,
      message:
        "Error: no VoiceService Provider is configured. Inject a service or set XRK_VOICE.",
      summary: "memory (CI/demo Provider)",
    };
  }
  if (engine === "local") {
    if (!asr) {
      return {
        kind: "system",
        ready: true,
        message:
          "Error: local TTS could not run this Host's speech command. " +
          "Windows uses PowerShell + System.Speech, macOS uses `say`, Linux uses `espeak-ng`.",
        summary: "local system TTS (SAPI · say · espeak-ng)",
      };
    }
    return {
      kind: "local",
      ready: true,
      message:
        "Error: SenseVoice local STT is enabled but not usable. Place ONNX assets under " +
        "{XRK_HOME}/voice/sensevoice (or XRK_VOICE_SENSEVOICE_DIR) and install sherpa-onnx-node.",
      summary: "local SenseVoice Provider (assets + sherpa-onnx-node required for STT)",
    };
  }
  if (engine === "openai") {
    if (!hasApiKey(env)) {
      return {
        kind: "openai-missing-key",
        ready: false,
        message:
          `Error: ${asr ? "speech input" : "text-to-speech"} is enabled but no API key. ` +
          "Set Credentials XRK_VOICE_OPENAI_KEY (or OPENAI_API_KEY); optional base URL " +
          "via Settings or XRK_VOICE_BASE_URL.",
        summary: `openai enabled but API key missing (Credentials XRK_VOICE_OPENAI_KEY)`,
      };
    }
    return {
      kind: "openai-ready",
      ready: true,
      message:
        "Error: no VoiceService Provider is configured. Inject a service or set XRK_VOICE.",
      summary: "openai-compatible Provider",
    };
  }
  return {
    kind: "unknown",
    ready: false,
    message:
      "Error: no VoiceService Provider is configured. Inject a service or set XRK_VOICE.",
    summary: `unknown voice engine=${engine}`,
  };
}

/** Tool execute error string — same facts as {@link describeVoiceAccess}. */
export function voiceUnavailableMessage(
  env: NodeJS.ProcessEnv,
  facts: VoiceAccessFacts,
): string {
  return describeVoiceAccess(env, facts).message;
}
