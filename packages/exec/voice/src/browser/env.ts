/**
 * Runtime resolution of browser globals + shared error mapping.
 *
 * Everything is read structurally off `globalThis` so this module never
 * references `lib.dom` and degrades to an honest `VOICE_UNAVAILABLE`.
 */
import { VoiceError } from "../types.js";
import type {
  BrowserVoiceDeps,
  GetUserMedia,
  VoiceMediaRecorderCtor,
  VoiceMediaStream,
  VoicePeerConnectionCtor,
} from "./types.js";

/** Stop every track on a stream; a dead track must not mask the real error. */
export function releaseStream(stream: VoiceMediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Ignore: releasing the mic is best-effort cleanup.
    }
  }
}

interface BrowserGlobals {
  readonly navigator?: {
    readonly mediaDevices?: { readonly getUserMedia?: unknown };
  };
  readonly MediaRecorder?: unknown;
  readonly RTCPeerConnection?: unknown;
  readonly btoa?: unknown;
}

function globals(): BrowserGlobals {
  return globalThis as unknown as BrowserGlobals;
}

export function resolveGetUserMedia(deps: BrowserVoiceDeps): GetUserMedia {
  const fn = deps.getUserMedia ?? globals().navigator?.mediaDevices?.getUserMedia;
  if (typeof fn !== "function") {
    throw new VoiceError(
      "navigator.mediaDevices.getUserMedia is unavailable — the browser mic transport " +
        "needs a secure (https / localhost) browser context, or an injected getUserMedia",
      "VOICE_UNAVAILABLE",
    );
  }
  return fn as GetUserMedia;
}

export function resolveRecorder(deps: BrowserVoiceDeps): VoiceMediaRecorderCtor {
  const ctor = deps.MediaRecorder ?? globals().MediaRecorder;
  if (typeof ctor !== "function") {
    throw new VoiceError(
      "MediaRecorder is unavailable — inject MediaRecorder or use a browser that supports it",
      "VOICE_UNAVAILABLE",
    );
  }
  return ctor as VoiceMediaRecorderCtor;
}

export function resolvePeerConnection(deps: BrowserVoiceDeps): VoicePeerConnectionCtor {
  const ctor = deps.PeerConnection ?? globals().RTCPeerConnection;
  if (typeof ctor !== "function") {
    throw new VoiceError(
      "RTCPeerConnection is unavailable — inject PeerConnection or use a browser that supports WebRTC",
      "VOICE_UNAVAILABLE",
    );
  }
  return ctor as VoicePeerConnectionCtor;
}

/** `btoa`-based Base64 for a byte buffer (chunked to avoid call-stack limits). */
export function encodeBase64(
  bytes: Uint8Array,
  btoaImpl?: (data: string) => string,
): string {
  const fn = btoaImpl ?? globals().btoa;
  if (typeof fn !== "function") {
    throw new VoiceError(
      "btoa is unavailable — inject deps.btoa or run in a browser context",
      "VOICE_UNAVAILABLE",
    );
  }
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return fn(binary);
}

function errorName(err: unknown): string {
  if (err && typeof err === "object" && "name" in err) {
    return String((err as { name?: unknown }).name ?? "");
  }
  return "";
}

/** Map a `getUserMedia` rejection to a coded `VoiceError` with an actionable hint. */
export function micError(err: unknown): VoiceError {
  if (err instanceof VoiceError) return err;
  const name = errorName(err);
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return new VoiceError(
        `microphone permission was denied (${name}); grant mic access to continue`,
        "VOICE_BACKEND",
      );
    case "NotFoundError":
    case "OverconstrainedError":
      return new VoiceError(
        `no usable microphone was found (${name})`,
        "VOICE_BACKEND",
      );
    case "NotReadableError":
      return new VoiceError(
        `microphone is already in use or unreadable (${name})`,
        "VOICE_BACKEND",
      );
    default: {
      const detail = err instanceof Error ? err.message : String(err);
      return new VoiceError(
        `getUserMedia failed${name ? ` (${name})` : ""}: ${detail}`,
        "VOICE_BACKEND",
      );
    }
  }
}

/** True when both capture paths have their required globals present. */
export function micCapabilities(deps: BrowserVoiceDeps = {}): {
  readonly dictation: boolean;
  readonly session: boolean;
} {
  const g = globals();
  const hasMic =
    typeof deps.getUserMedia === "function" ||
    typeof g.navigator?.mediaDevices?.getUserMedia === "function";
  const hasRecorder =
    typeof deps.MediaRecorder === "function" || typeof g.MediaRecorder === "function";
  const hasRtc =
    typeof deps.PeerConnection === "function" ||
    typeof g.RTCPeerConnection === "function";
  return { dictation: hasMic && hasRecorder, session: hasMic && hasRtc };
}
