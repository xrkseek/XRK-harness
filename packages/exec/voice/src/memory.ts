import type {
  VoiceLiveCreateRequest,
  VoiceLiveCreateResult,
  VoiceLiveStatus,
  VoiceService,
  VoiceSynthesizeRequest,
  VoiceSynthesizeResult,
  VoiceTranscribeRequest,
  VoiceTranscribeResult,
} from "./types.js";
import { VoiceError } from "./types.js";

/** Minimal silent WAV (44-byte header + 0 samples). */
export function minimalWavBytes(): Uint8Array {
  const buf = new Uint8Array(44);
  const view = new DataView(buf.buffer);
  // RIFF
  buf.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, 36, true);
  buf.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
  buf.set([0x66, 0x6d, 0x74, 0x20], 12); // fmt
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  buf.set([0x64, 0x61, 0x74, 0x61], 36); // data
  view.setUint32(40, 0, true);
  return buf;
}

export interface MemoryVoiceOptions {
  readonly transcript?: string;
}

/**
 * Deterministic in-memory Provider for CI / demos (`XRK_VOICE=memory`).
 */
export function createMemoryVoiceProvider(
  options: MemoryVoiceOptions = {},
): VoiceService {
  const sessions = new Map<string, { instructions?: string }>();
  let seq = 0;
  return {
    async synthesize(req: VoiceSynthesizeRequest): Promise<VoiceSynthesizeResult> {
      const text = String(req.text ?? "").trim();
      if (!text) {
        throw new VoiceError("synthesize text is empty", "VOICE_BAD_ARGS");
      }
      return {
        bytes: minimalWavBytes(),
        mimeType: "audio/wav",
        provider: "memory",
        delivery: "memory",
        note: `memory-tts:${text.slice(0, 80)}`,
      };
    },
    async transcribe(
      req: VoiceTranscribeRequest,
    ): Promise<VoiceTranscribeResult> {
      if (!req.bytes || req.bytes.byteLength === 0) {
        throw new VoiceError("transcribe audio is empty", "VOICE_BAD_ARGS");
      }
      const text = options.transcript ?? "[memory-stt]";
      return {
        text,
        provider: "memory",
        delivery: "memory",
        noSpeech: false,
      };
    },
    async createLiveSession(
      req: VoiceLiveCreateRequest,
    ): Promise<VoiceLiveCreateResult> {
      const sessionId = `voice_mem_${(++seq).toString(16)}`;
      sessions.set(sessionId, {
        ...(req.instructions !== undefined
          ? { instructions: req.instructions }
          : {}),
      });
      const result: VoiceLiveCreateResult = {
        sessionId,
        provider: "memory",
        delivery: "memory",
        note: "memory live session (no WebRTC); client should treat as stub",
      };
      if (req.sdpOffer) {
        return {
          ...result,
          sdpAnswer: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=memory\r\n",
        };
      }
      return result;
    },
    liveStatus(): VoiceLiveStatus {
      return {
        available: true,
        mode: "live",
        provider: "memory",
        reason: `${sessions.size} open memory session(s)`,
      };
    },
  };
}
