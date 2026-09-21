/**
 * `@xrkseek/exec-voice/browser` — client-side mic transport for the voice seam.
 *
 * Nothing here runs on the Host: the Node entry (`../index.js`) stays DOM-free.
 * The browser opens the mic, captures dictation or negotiates a WebRTC session,
 * and the Host only brokers sessions and runs STT/TTS — audio never transits it.
 *
 * Every dependency is injected through `BrowserVoiceDeps`, so the transport is
 * unit-testable with fakes and never hard-references `lib.dom`.
 */
import {
  dictateOnce,
  startDictation,
  type DictateOnceOptions,
  type DictationRecorder,
  type DictationResult,
  type StartDictationOptions,
} from "./dictation.js";
import { micCapabilities } from "./env.js";
import {
  startVoiceSession,
  type StartVoiceSessionOptions,
  type VoiceSessionHandle,
} from "./session.js";
import type { BrowserVoiceDeps, VoiceSessionBroker } from "./types.js";

export {
  dictateOnce,
  pickRecorderMime,
  startDictation,
  RECORDER_MIME_CANDIDATES,
  type DictateOnceOptions,
  type DictationRecorder,
  type DictationResult,
  type StartDictationOptions,
} from "./dictation.js";
export { encodeBase64, micCapabilities, releaseStream } from "./env.js";
export {
  startVoiceSession,
  type StartVoiceSessionOptions,
  type VoiceSessionHandle,
} from "./session.js";
export type {
  BrowserVoiceDeps,
  GetUserMedia,
  MicConstraints,
  VoiceAudioTrack,
  VoiceBlob,
  VoiceMediaRecorder,
  VoiceMediaRecorderCtor,
  VoiceMediaStream,
  VoicePeerConnection,
  VoicePeerConnectionCtor,
  VoiceRecorderEvent,
  VoiceSessionBroker,
  VoiceSessionBrokerRequest,
  VoiceSessionBrokerResult,
  VoiceSessionDescription,
} from "./types.js";

export interface BrowserVoiceCapabilities {
  readonly dictation: boolean;
  readonly session: boolean;
}

export interface DictateOptions {
  readonly mimeType?: string;
  readonly timesliceMs?: number;
  readonly maxDurationMs?: number;
}

export interface SessionOptions {
  readonly broker: VoiceSessionBroker;
  readonly instructions?: string;
  readonly voice?: string;
  readonly model?: string;
  readonly onStateChange?: (state: string) => void;
}

/**
 * The client-facing facade: capability probe plus the two capture paths.
 * Construct once per browser session and share it with the UI.
 */
export interface BrowserVoiceTransport {
  readonly deps: BrowserVoiceDeps;
  capabilities(): BrowserVoiceCapabilities;
  /** Push-to-talk take → bytes + Base64, ready for `voice_transcribe`. */
  dictate(
    options?: DictateOptions,
  ): Promise<DictationResult & { readonly base64: string }>;
  /** Manual recording control (start now, stop when the user releases). */
  openDictation(options?: StartDictationOptions): Promise<DictationRecorder>;
  /** Realtime session: mic + WebRTC, brokered by the Host. */
  session(options: SessionOptions): Promise<VoiceSessionHandle>;
}

export function createBrowserVoiceTransport(
  deps: BrowserVoiceDeps = {},
): BrowserVoiceTransport {
  return {
    deps,
    capabilities: () => micCapabilities(deps),
    dictate: (options = {}) => {
      const once: DictateOnceOptions = {
        deps,
        ...(options.mimeType !== undefined ? { mimeType: options.mimeType } : {}),
        ...(options.timesliceMs !== undefined
          ? { timesliceMs: options.timesliceMs }
          : {}),
        ...(options.maxDurationMs !== undefined
          ? { maxDurationMs: options.maxDurationMs }
          : {}),
      };
      return dictateOnce(once);
    },
    openDictation: (options = {}) => startDictation({ ...options, deps }),
    session: (options) => {
      const start: StartVoiceSessionOptions = {
        ...options,
        deps,
      };
      return startVoiceSession(start);
    },
  };
}
