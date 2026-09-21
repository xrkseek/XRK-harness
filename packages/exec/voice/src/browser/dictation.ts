/**
 * Push-to-talk dictation capture: mic → encoded audio bytes for `voice_transcribe`.
 * Recording never leaves the client; only the finished bytes are handed back.
 */
import { VoiceError } from "../types.js";
import {
  encodeBase64,
  micError,
  releaseStream,
  resolveGetUserMedia,
  resolveRecorder,
} from "./env.js";
import type {
  BrowserVoiceDeps,
  VoiceBlob,
  VoiceMediaRecorder,
  VoiceMediaStream,
} from "./types.js";

/**
 * Preferred recorder containers, best first. Whisper-style STT accepts
 * webm/opus, ogg/opus and mp4, so the negotiation order is opus-first.
 */
export const RECORDER_MIME_CANDIDATES: readonly string[] = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

/** First candidate the recorder accepts; `undefined` lets it pick its default. */
export function pickRecorderMime(
  isTypeSupported?: (mimeType: string) => boolean,
): string | undefined {
  if (!isTypeSupported) return RECORDER_MIME_CANDIDATES[0];
  for (const candidate of RECORDER_MIME_CANDIDATES) {
    if (isTypeSupported(candidate)) return candidate;
  }
  return undefined;
}

export interface DictationResult {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly durationMs: number;
}

export interface DictationRecorder {
  /** Container the recorder reports once recording has begun. */
  readonly mimeType: string;
  isRecording(): boolean;
  /** Finalize and return the audio; the mic is released either way. */
  stop(): Promise<DictationResult>;
  /** Abandon the take and release the mic without producing audio. */
  cancel(): void;
}

export interface StartDictationOptions {
  readonly deps?: BrowserVoiceDeps;
  /** Force a container instead of negotiating with the recorder. */
  readonly mimeType?: string;
  /** `MediaRecorder.start(timeslice)`; omit to buffer until `stop`. */
  readonly timesliceMs?: number;
  readonly now?: () => number;
}

/**
 * Acquire the mic and begin recording. Rejects (with `VoiceError`) when the
 * browser lacks the APIs or the user denies permission — nothing is recorded.
 */
export async function startDictation(
  options: StartDictationOptions = {},
): Promise<DictationRecorder> {
  const deps = options.deps ?? {};
  const getUserMedia = resolveGetUserMedia(deps);
  const Recorder = resolveRecorder(deps);
  const now = options.now ?? (() => Date.now());

  let stream: VoiceMediaStream;
  try {
    stream = await getUserMedia({ audio: true });
  } catch (err) {
    throw micError(err);
  }

  const probe = Recorder.isTypeSupported;
  const negotiated =
    options.mimeType ??
    pickRecorderMime(typeof probe === "function" ? probe : undefined);

  let recorder: VoiceMediaRecorder;
  try {
    recorder = negotiated
      ? new Recorder(stream, { mimeType: negotiated })
      : new Recorder(stream);
  } catch (err) {
    releaseStream(stream);
    throw new VoiceError(
      `MediaRecorder could not start${negotiated ? ` with ${negotiated}` : ""}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      "VOICE_BACKEND",
    );
  }

  const blobs: VoiceBlob[] = [];
  let observedMime = recorder.mimeType || negotiated || "";
  let failure: VoiceError | undefined;
  let resolveStopped: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      blobs.push(event.data);
      if (event.data.type) observedMime = event.data.type;
    }
  };
  recorder.onerror = (event) => {
    const detail =
      event && typeof event === "object" && "name" in event
        ? String((event as { name?: unknown }).name ?? "")
        : "";
    failure = new VoiceError(
      `MediaRecorder error${detail ? ` (${detail})` : ""}`,
      "VOICE_BACKEND",
    );
    resolveStopped?.();
  };
  recorder.onstop = () => resolveStopped?.();

  try {
    recorder.start(options.timesliceMs);
  } catch (err) {
    releaseStream(stream);
    throw new VoiceError(
      `MediaRecorder.start failed: ${err instanceof Error ? err.message : String(err)}`,
      "VOICE_BACKEND",
    );
  }

  const startedAt = now();
  type Phase = "recording" | "stopping" | "done" | "cancelled";
  let phase: Phase = "recording";
  let stopPromise: Promise<DictationResult> | undefined;

  const halt = (): void => {
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      // Stopping an already-dead recorder is not an error worth surfacing.
    }
  };

  const finalize = async (): Promise<DictationResult> => {
    halt();
    await stopped;
    releaseStream(stream);
    if (failure) throw failure;
    const durationMs = Math.max(0, now() - startedAt);
    const parts: Uint8Array[] = [];
    for (const blob of blobs) {
      parts.push(new Uint8Array(await blob.arrayBuffer()));
    }
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    if (total === 0) {
      throw new VoiceError("no audio was captured", "VOICE_BAD_ARGS");
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    phase = "done";
    return { bytes, mimeType: observedMime || "audio/webm", durationMs };
  };

  return {
    mimeType: observedMime || "audio/webm",
    isRecording: () => phase === "recording",
    stop(): Promise<DictationResult> {
      if (phase === "cancelled") {
        return Promise.reject(
          new VoiceError("dictation was cancelled", "VOICE_BAD_ARGS"),
        );
      }
      // Repeated `stop()` calls (e.g. a duration cap racing the caller) share
      // one finalize so the take is never assembled twice.
      stopPromise ??= finalize();
      return stopPromise;
    },
    cancel(): void {
      if (phase === "done" || phase === "cancelled") return;
      phase = "cancelled";
      halt();
      releaseStream(stream);
    },
  };
}

export interface DictateOnceOptions extends StartDictationOptions {
  /** Milliseconds to record before auto-stopping (default 15000). */
  readonly maxDurationMs?: number;
}

/** Record a single take with a safety cap, returning bytes + Base64. */
export async function dictateOnce(
  options: DictateOnceOptions = {},
): Promise<DictationResult & { readonly base64: string }> {
  const recorder = await startDictation(options);
  const cap = options.maxDurationMs ?? 15_000;
  const timer =
    cap > 0
      ? setTimeout(() => {
          void recorder.stop().catch(() => undefined);
        }, cap)
      : undefined;
  try {
    const result = await recorder.stop();
    return {
      ...result,
      base64: encodeBase64(result.bytes, options.deps?.btoa),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
