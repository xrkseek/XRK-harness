/**
 * Voice Host seam — TTS · dictation (STT) · realtime voice session.
 * Mic/speaker stay client-side; this package owns Provider contracts + tools.
 */

export type VoiceDelivery = "memory" | "openai" | "unavailable";

export type VoiceErrorCode =
  | "VOICE_UNAVAILABLE"
  | "VOICE_BAD_ARGS"
  | "VOICE_BACKEND"
  | "VOICE_LIVE_UNSUPPORTED";

export class VoiceError extends Error {
  readonly code: VoiceErrorCode;

  constructor(message: string, code: VoiceErrorCode = "VOICE_BACKEND") {
    super(message);
    this.name = "VoiceError";
    this.code = code;
  }
}

export function isVoiceError(err: unknown): err is VoiceError {
  return err instanceof VoiceError;
}

export interface VoiceSynthesizeRequest {
  readonly text: string;
  readonly voice?: string;
  readonly format?: "mp3" | "wav" | "opus";
}

export interface VoiceSynthesizeResult {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly provider: string;
  readonly delivery: VoiceDelivery;
  /** Short diagnostic for tool text (not raw audio). */
  readonly note?: string;
}

export interface VoiceTranscribeRequest {
  readonly bytes: Uint8Array;
  readonly mimeType?: string;
  readonly language?: string;
  readonly filename?: string;
}

export interface VoiceTranscribeResult {
  readonly text: string;
  readonly provider: string;
  readonly delivery: VoiceDelivery;
  readonly noSpeech?: boolean;
}

export interface VoiceLiveCreateRequest {
  readonly sdpOffer?: string;
  readonly instructions?: string;
  readonly voice?: string;
  readonly model?: string;
}

export interface VoiceLiveCreateResult {
  readonly sessionId: string;
  readonly provider: string;
  readonly delivery: VoiceDelivery;
  /** SDP answer when WebRTC offer was supplied. */
  readonly sdpAnswer?: string;
  /** Ephemeral client secret for browser WebRTC (never log). */
  readonly clientSecret?: string;
  readonly note?: string;
}

export interface VoiceLiveStatus {
  readonly available: boolean;
  readonly mode: "chained" | "live" | "none";
  readonly provider: string;
  readonly reason?: string;
}

/**
 * Definition: Host voice capability Provider.
 * Tools always register; missing Provider → honest execute error.
 */
export interface VoiceService {
  synthesize(req: VoiceSynthesizeRequest): Promise<VoiceSynthesizeResult>;
  transcribe(req: VoiceTranscribeRequest): Promise<VoiceTranscribeResult>;
  createLiveSession(
    req: VoiceLiveCreateRequest,
  ): Promise<VoiceLiveCreateResult>;
  liveStatus(): VoiceLiveStatus;
}
