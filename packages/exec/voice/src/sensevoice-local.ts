/**
 * Local SenseVoice STT Provider (DSH-aligned seam).
 *
 * - Inspects `{XRK_HOME}/voice/sensevoice` (or `XRK_VOICE_SENSEVOICE_DIR`) for
 *   ONNX model + tokens.txt + Silero VAD — same asset names as DSH.
 * - Transcription uses optional peer `sherpa-onnx-node` when present; otherwise
 *   fails honestly (no download/prepare pipeline in this MVP slice).
 * - TTS uses the in-process memory stub (local speak); live session unsupported.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { createMemoryVoiceProvider } from "./memory.js";
import {
  VoiceError,
  type VoiceLiveCreateRequest,
  type VoiceLiveCreateResult,
  type VoiceLiveStatus,
  type VoiceService,
  type VoiceSynthesizeRequest,
  type VoiceSynthesizeResult,
  type VoiceTranscribeRequest,
  type VoiceTranscribeResult,
} from "./types.js";

const LANGS = ["auto", "zh", "en", "ja", "ko", "yue"] as const;

export interface SenseVoiceAssetPaths {
  readonly dataRoot: string;
  readonly model: string;
  readonly tokens: string;
  readonly vad: string;
}

export interface SenseVoiceInspectResult {
  readonly ready: boolean;
  readonly dataRoot: string;
  readonly missing: readonly string[];
  readonly paths: SenseVoiceAssetPaths;
}

export interface SenseVoiceLocalOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Absolute model directory override. */
  readonly dataRoot?: string;
  /** Prefer int8 weights when both exist (DSH default). */
  readonly precision?: "int8" | "fp32";
  readonly threads?: number;
}

function resolveHome(env: NodeJS.ProcessEnv): string {
  const home = String(env.XRK_HOME ?? "").trim();
  if (home) return path.resolve(home);
  return path.join(homedir(), ".xrk");
}

/** Resolve SenseVoice data root (DSH-style absolute cache). */
export function senseVoiceDataRoot(
  env: NodeJS.ProcessEnv = process.env,
  override?: string,
): string {
  const fromOpt = override?.trim();
  if (fromOpt) return path.resolve(fromOpt);
  const fromEnv = String(env.XRK_VOICE_SENSEVOICE_DIR ?? "").trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(resolveHome(env), "voice", "sensevoice");
}

function resolveAssetPaths(
  dataRoot: string,
  precision: "int8" | "fp32",
): SenseVoiceAssetPaths {
  const int8 = path.join(dataRoot, "model.int8.onnx");
  const fp32 = path.join(dataRoot, "model.onnx");
  const model =
    precision === "int8"
      ? existsSync(int8)
        ? int8
        : fp32
      : existsSync(fp32)
        ? fp32
        : int8;
  return {
    dataRoot,
    model,
    tokens: path.join(dataRoot, "tokens.txt"),
    vad: path.join(dataRoot, "silero_vad.onnx"),
  };
}

/** Disk inspect — no downloads, no model load (DSH activation semantics). */
export function inspectSenseVoiceAssets(
  options: SenseVoiceLocalOptions = {},
): SenseVoiceInspectResult {
  const env = options.env ?? process.env;
  const dataRoot = senseVoiceDataRoot(env, options.dataRoot);
  const paths = resolveAssetPaths(dataRoot, options.precision ?? "int8");
  const missing: string[] = [];
  if (!existsSync(paths.model)) missing.push(path.basename(paths.model));
  if (!existsSync(paths.tokens)) missing.push("tokens.txt");
  if (!existsSync(paths.vad)) missing.push("silero_vad.onnx");
  return { ready: missing.length === 0, dataRoot, missing, paths };
}

interface SherpaRecognizer {
  createStream(): {
    acceptWaveform(audio: { samples: Float32Array; sampleRate: number }): void;
  };
  setConfig(config: object): void;
  decode(stream: {
    acceptWaveform(audio: { samples: Float32Array; sampleRate: number }): void;
  }): void;
  getResult(stream: {
    acceptWaveform(audio: { samples: Float32Array; sampleRate: number }): void;
  }): { text: string };
}

function tryLoadSherpa():
  | { ok: true; OfflineRecognizer: new (config: object) => SherpaRecognizer }
  | { ok: false; reason: string } {
  try {
    const req = createRequire(import.meta.url);
    const sherpa = req("sherpa-onnx-node") as {
      OfflineRecognizer: new (config: object) => SherpaRecognizer;
    };
    if (typeof sherpa?.OfflineRecognizer !== "function") {
      return { ok: false, reason: "sherpa-onnx-node OfflineRecognizer missing" };
    }
    return { ok: true, OfflineRecognizer: sherpa.OfflineRecognizer };
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof Error
          ? err.message
          : "sherpa-onnx-node is not installed",
    };
  }
}

function wavPcm16Mono(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength < 44) {
    throw new VoiceError("audio too short for WAV", "VOICE_BAD_ARGS");
  }
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset + 44,
    bytes.byteLength - 44,
  );
  if (view.byteLength < 2) {
    throw new VoiceError("WAV has no PCM samples", "VOICE_BAD_ARGS");
  }
  const samples = new Float32Array(view.byteLength / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }
  return samples;
}

/**
 * Local SenseVoice VoiceService. Ready only when ONNX assets + sherpa-onnx-node
 * are present; otherwise transcribe fails with prepare guidance.
 */
export function createSenseVoiceLocalProvider(
  options: SenseVoiceLocalOptions = {},
): VoiceService {
  const env = options.env ?? process.env;
  const threads = options.threads ?? 2;
  const tts = createMemoryVoiceProvider();
  const inspect = () =>
    inspectSenseVoiceAssets({
      env,
      ...(options.dataRoot ? { dataRoot: options.dataRoot } : {}),
      precision: options.precision ?? "int8",
    });

  return {
    async synthesize(
      req: VoiceSynthesizeRequest,
    ): Promise<VoiceSynthesizeResult> {
      const out = await tts.synthesize(req);
      return { ...out, provider: "sensevoice-local", delivery: "local" };
    },
    async transcribe(
      req: VoiceTranscribeRequest,
    ): Promise<VoiceTranscribeResult> {
      if (!req.bytes || req.bytes.byteLength === 0) {
        throw new VoiceError("transcribe audio is empty", "VOICE_BAD_ARGS");
      }
      const assets = inspect();
      if (!assets.ready) {
        throw new VoiceError(
          `SenseVoice local STT is not prepared. Missing [${assets.missing.join(", ")}] under ${assets.dataRoot}. ` +
            "Place DSH-compatible SenseVoiceSmall ONNX + tokens.txt + silero_vad.onnx " +
            "(or set XRK_VOICE_SENSEVOICE_DIR). See docs/voice.md.",
          "VOICE_UNAVAILABLE",
        );
      }
      const language = String(req.language ?? "auto").trim() || "auto";
      if (
        !(LANGS as readonly string[]).includes(language) &&
        language !== "auto"
      ) {
        throw new VoiceError(
          `Unsupported SenseVoice language '${language}' (use ${LANGS.join("|")})`,
          "VOICE_BAD_ARGS",
        );
      }
      const sherpa = tryLoadSherpa();
      if (!sherpa.ok) {
        throw new VoiceError(
          `SenseVoice assets are ready but sherpa-onnx-node is unavailable (${sherpa.reason}). ` +
            "Install sherpa-onnx-node in the Host runtime to enable local STT.",
          "VOICE_UNAVAILABLE",
        );
      }
      try {
        const nativeConfig = {
          featConfig: { sampleRate: 16000, featureDim: 80 },
          modelConfig: {
            senseVoice: {
              model: assets.paths.model,
              language,
              useInverseTextNormalization: 1,
            },
            tokens: assets.paths.tokens,
            numThreads: threads,
            provider: "cpu",
            debug: 0,
          },
        };
        const recognizer = new sherpa.OfflineRecognizer(nativeConfig);
        const samples = wavPcm16Mono(req.bytes);
        const stream = recognizer.createStream();
        stream.acceptWaveform({ samples, sampleRate: 16000 });
        recognizer.decode(stream);
        const text = String(recognizer.getResult(stream).text ?? "").trim();
        return {
          text: text || "[no-speech]",
          provider: "sensevoice-local",
          delivery: "local",
          noSpeech: !text,
        };
      } catch (err) {
        if (err instanceof VoiceError) throw err;
        throw new VoiceError(
          err instanceof Error ? err.message : String(err),
          "VOICE_BACKEND",
        );
      }
    },
    async createLiveSession(
      _req: VoiceLiveCreateRequest,
    ): Promise<VoiceLiveCreateResult> {
      throw new VoiceError(
        "SenseVoice local Provider has no realtime live session",
        "VOICE_LIVE_UNSUPPORTED",
      );
    },
    liveStatus(): VoiceLiveStatus {
      const assets = inspect();
      const sherpa = tryLoadSherpa();
      return {
        available: false,
        mode: "none",
        provider: "sensevoice-local",
        reason: assets.ready
          ? sherpa.ok
            ? "local STT ready; live unsupported"
            : `assets ready; ${sherpa.reason}`
          : `not prepared (missing ${assets.missing.join(", ") || "assets"})`,
      };
    },
  };
}
