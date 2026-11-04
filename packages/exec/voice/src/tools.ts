import type { ToolDefinition, ToolResultContent } from "@xrkseek/core-tools";
import type { AttachmentStore } from "@xrkseek/attachment";
import { voiceUnavailableMessage } from "./readiness.js";
import {
  VOICE_MAX_TTS_TEXT,
  VoiceError,
  isVoiceError,
  type VoiceDirection,
  type VoiceService,
} from "./types.js";

export {
  VOICE_ASR_PROMPT_TEXT,
  VOICE_PROMPT_TEXT,
  VOICE_TTS_PROMPT_TEXT,
  voicePromptText,
} from "./format.js";
export {
  describeVoiceAccess,
  voiceUnavailableMessage,
  type VoiceAccessFacts,
  type VoiceAccessDescription,
  type VoiceAccessKind,
} from "./readiness.js";

export interface CreateVoiceToolsOptions {
  readonly service?: VoiceService;
  readonly env?: NodeJS.ProcessEnv;
  /** Which half these tools serve; decides the honest-failure copy. */
  readonly direction?: VoiceDirection;
  /** Settings engine id this surface was built with. */
  readonly engine?: string;
  /**
   * Per-language voice rows. `text_to_speech` picks one by `language` (or by
   * sniffing the text on `auto`), so one agent can read Chinese notes and
   * English clips with a native voice instead of forcing one accent on both.
   * An unset row falls back to the engine's own default voice.
   */
  readonly voices?: { readonly zh?: string; readonly en?: string };
  /** Default spoken language when a call carries none (`auto` sniffs). */
  readonly language?: "auto" | "zh" | "en";
  /**
   * When set, synthesized audio is persisted and the tool result carries a
   * `file` block, so the client can play it. Without a store the bytes only
   * exist as a truncated base64 preview and nothing can play them.
   */
  readonly attachments?: AttachmentStore;
  /**
   * Which half to register. `speak` is only `text_to_speech` (Settings
   * `tts.enabled`); `listen` is transcription + live session (Settings
   * `asr.enabled`); default registers all three.
   */
  readonly surface?: "all" | "speak" | "listen";
}

/**
 * True when a clip reads as Chinese: at least one Han character and no more
 * Latin letters than Han ones. Short mixed strings ("OK 收到") stay Chinese,
 * which matches how people actually dictate.
 */
function looksChinese(text: string): boolean {
  const han = text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/gu)?.length ?? 0;
  if (han === 0) return false;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  return han >= latin;
}

/**
 * Resolve the voice for one call: an explicit `voice` wins, then the `en`/`zh`
 * row chosen by `language`, then the engine default (undefined).
 * @param input - call args, configured rows, and the text to sniff.
 * @returns the provider voice id, or undefined to keep the engine default.
 */
function chooseVoice(input: {
  readonly explicit?: string;
  readonly language?: "auto" | "zh" | "en";
  readonly text: string;
  readonly voices?: { readonly zh?: string; readonly en?: string };
}): string | undefined {
  if (input.explicit !== undefined && input.explicit.trim() !== "") {
    return input.explicit.trim();
  }
  const language =
    input.language === "zh" || input.language === "en"
      ? input.language
      : looksChinese(input.text)
        ? "zh"
        : "en";
  const row = language === "zh" ? input.voices?.zh : input.voices?.en;
  return row !== undefined && row.trim() !== "" ? row.trim() : undefined;
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

/** Container extension for a TTS mime type. */
function audioExtension(mimeType: string): string {
  const mime = mimeType.toLowerCase();
  if (mime.includes("wav")) return "wav";
  if (mime.includes("opus") || mime.includes("ogg")) return "opus";
  if (mime.includes("webm")) return "webm";
  return "mp3";
}

/**
 * Model-facing voice tools: text_to_speech · voice_transcribe · voice_session.
 */
export function createVoiceTools(
  options: CreateVoiceToolsOptions = {},
): ToolDefinition[] {
  const missing = voiceUnavailableMessage(options.env ?? process.env, {
    direction: options.direction ?? "asr",
    ...(options.engine === undefined ? {} : { engine: options.engine }),
  });
  const service = options.service;

  const tts: ToolDefinition<{
    text?: string;
    voice?: string;
    language?: string;
    format?: string;
  }> = {
    name: "text_to_speech",
    description:
      "Synthesize speech from text with the Host TTS engine. " +
      "The result is a session file attachment (`attachmentId` + a `file` block) so the client can play it — " +
      "the Host itself has no speaker. " +
      "Pass `voice` for a specific provider voice; Edge uses short names like `zh-CN-XiaoxiaoNeural` / `en-US-AriaNeural`. " +
      "`language` defaults to auto, which picks the configured Chinese or English voice from the text. " +
      "The engine is selected in Settings → Plugins → TTS (edge / local / openai).",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to speak." },
        voice: {
          type: "string",
          description:
            "Provider voice id. Edge: `zh-CN-XiaoxiaoNeural`, `en-US-AriaNeural`, … Local: an OS voice name.",
        },
        language: {
          type: "string",
          enum: ["auto", "zh", "en"],
          description:
            "Spoken language. `auto` (default) sniffs the text and uses the configured voice for that language; " +
            "`zh` / `en` force the Chinese or English row. Pass this when the text is a single foreign word or " +
            "mostly numbers, where sniffing cannot tell.",
        },
        format: {
          type: "string",
          enum: ["mp3", "wav", "opus"],
          description:
            "Container hint. Edge always streams MP3, local always WAV, openai honors the request.",
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
        if (text.length > VOICE_MAX_TTS_TEXT) {
          throw new VoiceError(
            `text is ${text.length} chars; text_to_speech accepts up to ${VOICE_MAX_TTS_TEXT}`,
            "VOICE_BAD_ARGS",
          );
        }
        const formatRaw = args.format
          ? String(args.format).trim()
          : undefined;
        const format =
          formatRaw === "mp3" || formatRaw === "wav" || formatRaw === "opus"
            ? formatRaw
            : undefined;
        const languageRaw = String(args.language ?? "").trim().toLowerCase();
        const language =
          languageRaw === "zh" || languageRaw === "en" || languageRaw === "auto"
            ? languageRaw
            : options.language;
        const voice = chooseVoice({
          ...(args.voice ? { explicit: String(args.voice) } : {}),
          ...(language !== undefined ? { language } : {}),
          text,
          ...(options.voices !== undefined ? { voices: options.voices } : {}),
        });
        const result = await service.synthesize({
          text,
          ...(voice !== undefined ? { voice } : {}),
          ...(format ? { format } : {}),
        });
        const meta = [
          `provider=${result.provider} delivery=${result.delivery} mime=${result.mimeType}`,
          result.voice ? `voice=${result.voice}` : "",
          language !== undefined ? `language=${language}` : "",
          result.note ? `note=${result.note}` : "",
        ].filter(Boolean);
        const attachments = options.attachments;
        if (attachments) {
          const ref = await attachments.saveFile({
            data: result.bytes,
            mediaType: result.mimeType,
            name: `tts-${Date.now()}.${audioExtension(result.mimeType)}`,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: [
                  ...meta,
                  `bytes=${ref.bytes} name=${ref.name} attachmentId=${ref.attachmentId}`,
                ].join("\n"),
              },
              {
                type: "file" as const,
                attachment: {
                  attachmentId: ref.attachmentId,
                  name: ref.name,
                  bytes: ref.bytes,
                  ...(ref.mediaType === undefined
                    ? { mediaType: result.mimeType }
                    : { mediaType: ref.mediaType }),
                },
              },
            ],
          };
        }
        // No store (CLI / unit tests): keep a short preview, but never let a
        // truncated envelope read as playable audio.
        const b64 = bytesToBase64(result.bytes);
        const preview =
          b64.length > 120 ? `${b64.slice(0, 120)}…(${b64.length} chars)` : b64;
        return {
          content: [
            ...meta,
            `audio_base64=${preview}`,
            b64.length > 120
              ? "(full base64 omitted — no attachment store on this Host, so the audio cannot be played)"
              : "",
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
    attachment_id?: string;
    mime_type?: string;
    language?: string;
    filename?: string;
  }> = {
    name: "voice_transcribe",
    description:
      "One-shot speech-to-text for an audio clip you already hold as base64 — " +
      "a voice message, a recorded file, or a clip the user dropped in. " +
      "Live microphone dictation is the client's ASR seat and never calls this tool. " +
      "Accepts raw base64 or a `data:audio/…;base64,` URL. " +
      "If the clip is already a session attachment, pass `attachment_id` instead of re-encoding it. " +
      "Returns provider/delivery then the transcript; `no_speech=true` means the clip held no speech. " +
      "Engine is chosen in Settings → Plugins → ASR (local SenseVoice, or an OpenAI-compatible endpoint).",
    parameters: {
      type: "object",
      properties: {
        audio_base64: {
          type: "string",
          description:
            "Base64 audio; a `data:audio/…;base64,` prefix is accepted and stripped.",
        },
        attachment_id: {
          type: "string",
          description:
            "Session file attachment id (`sha256:…` / `attachment:sha256:…`). " +
            "Preferred over audio_base64 when the clip was already uploaded.",
        },
        mime_type: {
          type: "string",
          description:
            "Container of the clip (default audio/wav). Browser captures are 16 kHz mono WAV.",
        },
        language: {
          type: "string",
          description:
            "BCP-47 hint (`zh-CN`, `en-US`). Short clips transcribe noticeably better with it.",
        },
        filename: {
          type: "string",
          description:
            "Filename hint (extension matters to some multipart gateways), e.g. `clip.wav`.",
        },
      },
      // Exactly one of attachment_id / audio_base64; execute validates.
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
        const attachmentId = String(args.attachment_id ?? "").trim();
        let bytes: Uint8Array;
        let mimeType = args.mime_type ? String(args.mime_type) : undefined;
        let filename = args.filename ? String(args.filename) : undefined;
        if (attachmentId !== "") {
          if (!options.attachments) {
            throw new VoiceError(
              "attachment_id needs an AttachmentStore on this Host; pass audio_base64 instead",
              "VOICE_BAD_ARGS",
            );
          }
          const stored = await options.attachments.readFile(attachmentId);
          bytes = stored.data;
          mimeType ??= stored.ref.mediaType;
          filename ??= stored.ref.name;
        } else {
          bytes = decodeAudio(args.audio_base64);
        }
        const result = await service.transcribe({
          bytes,
          ...(mimeType ? { mimeType } : {}),
          ...(args.language ? { language: String(args.language) } : {}),
          ...(filename ? { filename } : {}),
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
      "Realtime voice session broker — check with `status` before opening anything. " +
      "`status` reports whether the current engine has a live mode at all " +
      "(edge and local are one-shot TTS/ASR only; openai is the live-capable engine). " +
      "`create` opens an ephemeral session: openai returns a `client_secret` the browser uses to finish WebRTC, " +
      "and the memory provider returns a stub for tests. " +
      "Mic, speaker and SDP negotiation stay on the client — the Host never proxies media, " +
      "so this tool is only useful with a WebRTC-capable client.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "create"],
          description:
            "`status` = availability only; `create` = open an ephemeral session (default).",
        },
        sdp_offer: {
          type: "string",
          description:
            "WebRTC SDP offer. Only the memory stub answers it; openai returns a client_secret instead.",
        },
        instructions: {
          type: "string",
          description: "Persona / system instructions for the live session.",
        },
        voice: { type: "string", description: "Live voice id (provider-specific)." },
        model: { type: "string", description: "Realtime model id (provider-specific)." },
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

  if (options.surface === "speak") return [tts];
  if (options.surface === "listen") return [stt, live];
  return [tts, stt, live];
}

/**
 * Only `text_to_speech` — for Settings `tts.enabled` binding onto every tool
 * surface (Minimal / IM / Frugal) without voice_transcribe / voice_session.
 */
export function createSpeakTool(
  options: CreateVoiceToolsOptions = {},
): ToolDefinition {
  const [tts] = createVoiceTools({ ...options, surface: "speak" });
  return tts!;
}
