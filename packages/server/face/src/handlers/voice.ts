/**
 * Face `voice.transcribe` — composer dictation (browser capture → Host STT).
 *
 * The composer records in the browser and posts the clip here as base64, so
 * the Provider credential never leaves the Host. The ASR card is the only
 * switch both halves read: `asr.enabled` gates the seat, `asr.engine` picks
 * SenseVoice on this Host or an OpenAI-compatible endpoint, `asr.baseUrl`
 * points the latter at a compatible gateway, and credential `voice.openai`
 * carries the key shared with TTS.
 *
 * DSH-alignment: the clip arrives as 16 kHz mono PCM WAV (the browser decodes
 * and resamples before posting), which is what a local sherpa/SenseVoice
 * backend needs; OpenAI accepts the same WAV, so one capture format serves
 * both deliveries.
 */
import {
  SENSEVOICE_TOTAL_BYTES,
  createVoiceAccess,
  inspectSenseVoiceAssets,
  listEdgeVoices,
  listSystemVoices,
  parseProxy,
  probeSenseVoiceEngine,
  senseVoiceDataRoot,
  senseVoicePreparer,
  type SenseVoicePreparer,
} from "@xrkseek/exec-voice";
import { asRecord, remoteArgs, type FaceHandler } from "./types.js";

/** Cap one clip by base64 length (~40 M chars ≈ 30 MB of audio). */
const MAX_AUDIO_BASE64 = 40 * 1024 * 1024;

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export const voiceTranscribe: FaceHandler = async (runtime, _rpcId, payload) => {
  const args = remoteArgs(payload);
  const flat = asRecord(payload);
  const audio = trimmed(args.audio ?? flat.audio);
  if (audio === "") {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "audio (base64) required" },
    };
  }
  if (audio.length > MAX_AUDIO_BASE64) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: `audio clip too large (${audio.length} base64 chars, max ${MAX_AUDIO_BASE64})`,
      },
    };
  }
  const mimeType = trimmed(args.mimeType) || "audio/wav";
  const language = trimmed(args.language);
  const filename = trimmed(args.filename);

  // A probe is the ASR card's 「try a sentence」: it verifies the engine before
  // the switch is saved, so the enabled gate does not apply to it.
  const probe = (args.probe ?? flat.probe) === true;
  // ASR off means there is no dictation seat at all: answer that plainly
  // instead of probing a backend the user turned off.
  const ns = runtime.settingsNamespaces.view("asr").value as Record<string, unknown>;
  if (!probe && ns.enabled !== true) {
    return {
      ok: false,
      error: {
        code: "voice-disabled",
        message: "Speech input is off — turn on Settings → Plugins → ASR.",
      },
    };
  }
  const baseUrl = trimmed(ns.baseUrl);
  const key =
    runtime.credentials.peek("voice.openai")?.trim() ||
    process.env.XRK_VOICE_OPENAI_KEY?.trim() ||
    "";
  const env =
    key === "" ? undefined : { ...process.env, XRK_VOICE_OPENAI_KEY: key };
  const access = createVoiceAccess({
    direction: "asr",
    engine: trimmed(ns.engine),
    ...(baseUrl === "" ? {} : { baseUrl }),
    ...(env === undefined ? {} : { env }),
  });
  if (access.service === undefined) {
    return {
      ok: false,
      error: { code: "voice-unavailable", message: access.unavailableMessage },
    };
  }

  try {
    const result = await access.service.transcribe({
      bytes: new Uint8Array(Buffer.from(audio, "base64")),
      mimeType,
      ...(language === "" ? {} : { language }),
      ...(filename === "" ? {} : { filename }),
    });
    return {
      ok: true,
      value: {
        text: result.text,
        provider: result.provider,
        delivery: result.delivery,
        ...(result.noSpeech === undefined ? {} : { noSpeech: result.noSpeech }),
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "voice-backend",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
};

/**
 * One preparer per Host, keyed by the resolved data root.
 *
 * The download outlives any single settings panel (a card can be collapsed,
 * reopened, or asked from another session), so the task lives on the Host and
 * the card only ever reads its snapshot.
 */
function preparer(): SenseVoicePreparer {
  return senseVoicePreparer({ dataRoot: senseVoiceDataRoot(process.env) });
}

/**
 * Face `voice.inspect` — what the local engine needs, and what it already has.
 *
 * Deliberately cheap: disk stats plus one `require` of the optional binding.
 * No model load, no hashing of 238 MB — the card polls this on open.
 */
export const voiceInspect: FaceHandler = async (runtime) => {
  const assets = inspectSenseVoiceAssets({ env: process.env });
  const engine = probeSenseVoiceEngine(process.env);
  const ns = runtime.settingsNamespaces.view("asr").value as Record<string, unknown>;
  const proxyText = trimmed(ns.downloadProxy);
  // Echo the parsed verdict, not just the text: a card that shows the address
  // the user typed while the downloader quietly ignores it is the failure this
  // field already produced once.
  const proxyCheck = parseProxy(proxyText);
  return {
    ok: true,
    value: {
      dataRoot: assets.dataRoot,
      /** Both halves present: the weights on disk AND a binding that can run them. */
      ready: assets.ready && engine.supported && engine.engine,
      assets: {
        ready: assets.ready,
        missing: assets.missing,
        totalBytes: SENSEVOICE_TOTAL_BYTES,
      },
      engine,
      proxy: {
        text: proxyText,
        valid: proxyCheck.error === undefined,
        error: proxyCheck.error ?? null,
        target: proxyCheck.target === undefined
          ? null
          : `${proxyCheck.target.host}:${proxyCheck.target.port}`,
      },
      prepare: preparer().snapshot(),
    },
  };
};

/**
 * Face `voice.prepare` — start the download and answer immediately.
 *
 * Returning after the transfer instead would hold a unary RPC open for
 * minutes; the card polls `prepareStatus` instead, which also keeps progress
 * alive when the panel closes and reopens.
 */
export const voicePrepare: FaceHandler = async (runtime) => {
  const task = preparer();
  if (!task.busy) {
    // An empty `downloadProxy` means 「direct」. The field exists because the
    // upstream 302 lands on a CDN host that answers `curl` and ignores Node on
    // some filtered networks; naming a proxy is the user's call, never a guess
    // this Host makes on their behalf.
    const ns = runtime.settingsNamespaces.view("asr").value as Record<string, unknown>;
    const proxy = trimmed(ns.downloadProxy);
    // Fire-and-forget: failures settle onto the snapshot.
    void task.prepare(proxy === "" ? {} : { proxy });
  }
  return { ok: true, value: task.snapshot() };
};

/** Face `voice.prepareStatus` — the poll target while a transfer runs. */
export const voicePrepareStatus: FaceHandler = async () => ({
  ok: true,
  value: preparer().snapshot(),
});

/** Face `voice.prepareCancel` — abort and settle the snapshot as cancelled. */
export const voicePrepareCancel: FaceHandler = async () => ({
  ok: true,
  value: preparer().cancel(),
});

/**
 * Face `voice.voices` — the OS voices the local TTS engine can speak with.
 *
 * Best-effort: a platform without an enumerable voice list answers `[]` and
 * the card falls back to a free-text voice field. Failing the whole RPC would
 * hide the engine switch over a cosmetic list.
 */
export const voiceVoices: FaceHandler = async (runtime, _rpcId, payload) => {
  const args = remoteArgs(payload);
  const flat = asRecord(payload);
  const engine = trimmed(args.engine ?? flat.engine).toLowerCase();
  if (engine === "edge") {
    // The Edge catalog is the whole point of the engine: ~300 neural voices
    // across every locale. Best-effort like the OS list — a Host offline
    // answers [] and the card falls back to the stored free-text voice.
    // Honour Settings → TTS → proxy so a phone-hotspot / filtered LAN Host
    // can load the catalog after the operator points at Clash / mihomo.
    const ttsNs = runtime.settingsNamespaces.view("tts").value as Record<
      string,
      unknown
    >;
    const proxy = trimmed(ttsNs.proxy);
    try {
      const voices = await listEdgeVoices(proxy ? { proxy } : {});
      return {
        ok: true,
        value: {
          voices: voices.map((voice) => {
            const stem = voice.shortName.split("-").pop() ?? voice.shortName;
            const name = stem.replace(/Neural$/i, "");
            return {
              id: voice.shortName,
              label: `${name} · ${voice.locale} · ${voice.gender}`,
              locale: voice.locale,
            };
          }),
        },
      };
    } catch {
      return { ok: true, value: { voices: [] } };
    }
  }
  return { ok: true, value: { voices: await listSystemVoices() } };
};
