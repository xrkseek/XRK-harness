import type { ToolDefinition, ToolResultContent } from "@xrkseek/core-tools";
import { VOICE_PROMPT_TEXT } from "./format.js";
import {
  VoiceError,
  isVoiceError,
  type VoiceService,
} from "./types.js";

export { VOICE_PROMPT_TEXT };

export function voiceUnavailableMessage(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const flag = String(env.XRK_VOICE ?? "").trim().toLowerCase();
  if (!flag) {
    return (
      "Error: voice Host is not enabled. Set XRK_VOICE=memory (CI/demo) or " +
      "XRK_VOICE=1 with OPENAI_API_KEY / XRK_VOICE_OPENAI_KEY for OpenAI TTS · Whisper · realtime sessions. " +
      "See docs/voice.md."
    );
  }
  if (flag === "1") {
    return (
      "Error: XRK_VOICE=1 but no API key. Set OPENAI_API_KEY or XRK_VOICE_OPENAI_KEY " +
      "(optional XRK_VOICE_BASE_URL for compatible endpoints)."
    );
  }
  return (
    "Error: no VoiceService Provider is configured. Inject a service or set XRK_VOICE."
  );
}

export interface CreateVoiceToolsOptions {
  readonly service?: VoiceService;
  readonly env?: NodeJS.ProcessEnv;
}

function fail(err: unknown): ToolResultContent {
  const message = isVoiceError(err)
    ? `Error: ${err.message}`
    : `Error: ${err instanceof Error ? err.message : String(err)}`;
  return { content: message, isError: true };
}

function decodeAudio(raw: unknown): Uint8Array {
  const s = String(raw ?? "").trim();
  if (!s) {
    throw new VoiceError("audio_base64 is empty", "VOICE_BAD_ARGS");
  }
  const cleaned = s.replace(/^data:[^;]+;base64,/, "");
  try {
    return Uint8Array.from(Buffer.from(cleaned, "base64"));
  } catch {
    throw new VoiceError("audio_base64 is not valid base64", "VOICE_BAD_ARGS");
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * Model-facing voice tools: text_to_speech · voice_transcribe · voice_session.
 */
export function createVoiceTools(
  options: CreateVoiceToolsOptions = {},
): ToolDefinition[] {
  const missing = voiceUnavailableMessage(options.env ?? process.env);
  const service = options.service;

  const tts: ToolDefinition<{
    text?: string;
    voice?: string;
    format?: string;
  }> = {
    name: "text_to_speech",
    description:
      "Synthesize speech from text via the Host TTS Provider. Returns audio as base64 plus mime type. " +
      "Does not play audio on the server — the client/UI plays it.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to speak." },
        voice: {
          type: "string",
          description: "Optional voice id (provider-specific).",
        },
        format: {
          type: "string",
          enum: ["mp3", "wav", "opus"],
          description: "Audio format (default mp3 for OpenAI; wav for memory).",
        },
      },
      required: ["text"],
    },
    presentCall: (args) => ({
      card: "generic",
      title: "TTS",
      kind: "execute",
      rawInput: args,
    }),
    async execute(args) {
      if (!service) return { content: missing, isError: true };
      try {
        const text = String(args.text ?? "").trim();
        const formatRaw = args.format
          ? String(args.format).trim()
          : undefined;
        const format =
          formatRaw === "mp3" || formatRaw === "wav" || formatRaw === "opus"
            ? formatRaw
            : undefined;
        const result = await service.synthesize({
          text,
          ...(args.voice ? { voice: String(args.voice) } : {}),
          ...(format ? { format } : {}),
        });
        const b64 = bytesToBase64(result.bytes);
        const preview =
          b64.length > 120 ? `${b64.slice(0, 120)}…(${b64.length} chars)` : b64;
        return {
          content: [
            `provider=${result.provider} delivery=${result.delivery} mime=${result.mimeType}`,
            result.note ? `note=${result.note}` : "",
            `audio_base64=${preview}`,
            b64.length > 120 ? `(full base64 length ${b64.length}; truncated in tool text)` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        };
      } catch (err) {
        return fail(err);
      }
    },
  };

  const stt: ToolDefinition<{
    audio_base64?: string;
    mime_type?: string;
    language?: string;
    filename?: string;
  }> = {
    name: "voice_transcribe",
    description:
      "One-shot speech-to-text (dictation) on base64 audio. For message/file audio, not live mic streaming.",
    parameters: {
      type: "object",
      properties: {
        audio_base64: {
          type: "string",
          description: "Base64 audio (optional data: URL prefix).",
        },
        mime_type: {
          type: "string",
          description: "MIME type (default audio/wav).",
        },
        language: {
          type: "string",
          description: "Optional BCP-47 / ISO language hint.",
        },
        filename: {
          type: "string",
          description: "Optional filename hint for multipart STT APIs.",
        },
      },
      required: ["audio_base64"],
    },
    presentCall: (args) => ({
      card: "generic",
      title: "Transcribe",
      kind: "execute",
      rawInput: args,
    }),
    async execute(args) {
      if (!service) return { content: missing, isError: true };
      try {
        const bytes = decodeAudio(args.audio_base64);
        const result = await service.transcribe({
          bytes,
          ...(args.mime_type ? { mimeType: String(args.mime_type) } : {}),
          ...(args.language ? { language: String(args.language) } : {}),
          ...(args.filename ? { filename: String(args.filename) } : {}),
        });
        return {
          content: [
            `provider=${result.provider} delivery=${result.delivery}`,
            result.noSpeech ? "no_speech=true" : "",
            result.text,
          ]
            .filter(Boolean)
            .join("\n"),
        };
      } catch (err) {
        return fail(err);
      }
    },
  };

  const live: ToolDefinition<{
    action?: string;
    sdp_offer?: string;
    instructions?: string;
    voice?: string;
    model?: string;
  }> = {
    name: "voice_session",
    description:
      "Realtime voice session broker. action=status reports availability; action=create opens an ephemeral live session " +
      "(OpenAI client_secret or memory stub). Mic/speaker and WebRTC stay on the client — Host does not proxy media.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "create"],
          description: "status | create (default create).",
        },
        sdp_offer: {
          type: "string",
          description: "Optional SDP offer (memory stub returns a fake answer).",
        },
        instructions: {
          type: "string",
          description: "Optional session persona / system instructions.",
        },
        voice: { type: "string", description: "Optional live voice id." },
        model: { type: "string", description: "Optional realtime model id." },
      },
    },
    presentCall: (args) => ({
      card: "generic",
      title: "Voice session",
      kind: "execute",
      rawInput: args,
    }),
    async execute(args) {
      if (!service) return { content: missing, isError: true };
      try {
        const action = String(args.action ?? "create").trim().toLowerCase();
        if (action === "status") {
          const st = service.liveStatus();
          return {
            content: [
              `available=${st.available} mode=${st.mode} provider=${st.provider}`,
              st.reason ? `reason=${st.reason}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          };
        }
        if (action !== "create") {
          throw new VoiceError(
            "action must be status or create",
            "VOICE_BAD_ARGS",
          );
        }
        const result = await service.createLiveSession({
          ...(args.sdp_offer ? { sdpOffer: String(args.sdp_offer) } : {}),
          ...(args.instructions
            ? { instructions: String(args.instructions) }
            : {}),
          ...(args.voice ? { voice: String(args.voice) } : {}),
          ...(args.model ? { model: String(args.model) } : {}),
        });
        return {
          content: [
            `sessionId=${result.sessionId}`,
            `provider=${result.provider} delivery=${result.delivery}`,
            result.sdpAnswer ? `sdpAnswer=${result.sdpAnswer}` : "",
            result.clientSecret
              ? `clientSecret=${result.clientSecret}`
              : "",
            result.note ? `note=${result.note}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        };
      } catch (err) {
        return fail(err);
      }
    },
  };

  return [tts, stt, live];
}
