/**
 * OpenAI-compatible HTTP voice Provider (TTS · Whisper STT · Realtime session).
 * Key stays server-side; live returns ephemeral client_secret for browser WebRTC.
 */
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

export interface OpenAiVoiceOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly ttsModel?: string;
  readonly sttModel?: string;
  readonly liveModel?: string;
  readonly defaultVoice?: string;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function createOpenAiVoiceProvider(
  options: OpenAiVoiceOptions,
): VoiceService {
  const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(
    /\/+$/,
    "",
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const ttsModel = options.ttsModel ?? "gpt-4o-mini-tts";
  const sttModel = options.sttModel ?? "whisper-1";
  const liveModel = options.liveModel ?? "gpt-4o-realtime-preview";
  const defaultVoice = options.defaultVoice ?? "alloy";

  const headers = (): Record<string, string> => ({
    Authorization: `Bearer ${options.apiKey}`,
  });

  return {
    async synthesize(req: VoiceSynthesizeRequest): Promise<VoiceSynthesizeResult> {
      const text = String(req.text ?? "").trim();
      if (!text) {
        throw new VoiceError("synthesize text is empty", "VOICE_BAD_ARGS");
      }
      const format = req.format ?? "mp3";
      const res = await fetchImpl(joinUrl(baseUrl, "audio/speech"), {
        method: "POST",
        headers: {
          ...headers(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: ttsModel,
          input: text,
          voice: req.voice ?? defaultVoice,
          response_format: format,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new VoiceError(
          `OpenAI TTS HTTP ${res.status}: ${body.slice(0, 200)}`,
          "VOICE_BACKEND",
        );
      }
      const ab = await res.arrayBuffer();
      const mime =
        format === "wav"
          ? "audio/wav"
          : format === "opus"
            ? "audio/opus"
            : "audio/mpeg";
      return {
        bytes: new Uint8Array(ab),
        mimeType: mime,
        provider: "openai",
        delivery: "openai",
        note: `openai-tts bytes=${ab.byteLength}`,
      };
    },

    async transcribe(
      req: VoiceTranscribeRequest,
    ): Promise<VoiceTranscribeResult> {
      if (!req.bytes || req.bytes.byteLength === 0) {
        throw new VoiceError("transcribe audio is empty", "VOICE_BAD_ARGS");
      }
      const form = new FormData();
      const blob = new Blob([req.bytes], {
        type: req.mimeType ?? "audio/wav",
      });
      form.append("file", blob, req.filename ?? "audio.wav");
      form.append("model", sttModel);
      if (req.language) form.append("language", req.language);
      const res = await fetchImpl(joinUrl(baseUrl, "audio/transcriptions"), {
        method: "POST",
        headers: headers(),
        body: form,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new VoiceError(
          `OpenAI STT HTTP ${res.status}: ${body.slice(0, 200)}`,
          "VOICE_BACKEND",
        );
      }
      const json = (await res.json()) as { text?: string };
      const text = String(json.text ?? "").trim();
      return {
        text,
        provider: "openai",
        delivery: "openai",
        noSpeech: text.length === 0,
      };
    },

    async createLiveSession(
      req: VoiceLiveCreateRequest,
    ): Promise<VoiceLiveCreateResult> {
      const res = await fetchImpl(joinUrl(baseUrl, "realtime/sessions"), {
        method: "POST",
        headers: {
          ...headers(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: req.model ?? liveModel,
          voice: req.voice ?? defaultVoice,
          ...(req.instructions
            ? { instructions: req.instructions }
            : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new VoiceError(
          `OpenAI realtime session HTTP ${res.status}: ${body.slice(0, 200)}`,
          "VOICE_BACKEND",
        );
      }
      const json = (await res.json()) as {
        id?: string;
        client_secret?: { value?: string };
      };
      const sessionId = String(json.id ?? "").trim();
      if (!sessionId) {
        throw new VoiceError(
          "OpenAI realtime session missing id",
          "VOICE_BACKEND",
        );
      }
      const secret = json.client_secret?.value;
      const result: VoiceLiveCreateResult = {
        sessionId,
        provider: "openai",
        delivery: "openai",
        note:
          "Ephemeral realtime session created. Client completes WebRTC with client_secret; " +
          "Host does not proxy media.",
      };
      if (secret) {
        return { ...result, clientSecret: secret };
      }
      if (req.sdpOffer) {
        return {
          ...result,
          note:
            `${result.note} SDP offer ignored — OpenAI session endpoint returns client_secret, not SDP answer.`,
        };
      }
      return result;
    },

    liveStatus(): VoiceLiveStatus {
      return {
        available: true,
        mode: "live",
        provider: "openai",
      };
    },
  };
}
