/**
 * Voice engine registry — one row per Provider, split by direction.
 *
 * Adding an engine is one row here plus the settings enum: the Host mount, the
 * Face handler and the cards all resolve through this table instead of each
 * growing its own `if (engine === …)` ladder.
 */
import { createEdgeVoiceProvider, EDGE_DEFAULT_VOICE } from "./edge-tts.js";
import { createMemoryVoiceProvider } from "./memory.js";
import { createOpenAiVoiceProvider } from "./openai-http.js";
import { createSenseVoiceLocalProvider } from "./sensevoice-local.js";
import { createSystemVoiceProvider } from "./system-tts.js";
import { resolveEngineId } from "./engine-ids.js";
import { voiceUnavailableMessage } from "./readiness.js";
import type { VoiceDirection, VoiceService } from "./types.js";

export type { VoiceDirection } from "./types.js";

/** Everything an engine factory may read from Settings + the environment. */
export interface VoiceEngineContext {
  readonly env: NodeJS.ProcessEnv;
  /** OpenAI-compatible endpoint override. */
  readonly baseUrl?: string;
  /** Local: OS voice name. Cloud: provider voice id. */
  readonly voice?: string;
  /** Cloud-only TTS model id. */
  readonly model?: string;
  readonly fetchImpl?: typeof fetch;
}

/** One registered engine. */
export interface VoiceEngineSpec {
  readonly id: string;
  readonly direction: VoiceDirection;
  /** Cloud engines cannot be built without the shared OpenAI-compatible key. */
  readonly needsKey: boolean;
  /** Build the Provider, or undefined when its credential is missing. */
  readonly create: (ctx: VoiceEngineContext) => VoiceService | undefined;
}

/** First key wins; `OPENAI_API_KEY` is the conventional fallback. */
function resolveApiKey(env: NodeJS.ProcessEnv): string | undefined {
  const explicit = String(env.XRK_VOICE_OPENAI_KEY ?? "").trim();
  if (explicit !== "") return explicit;
  const conventional = String(env.OPENAI_API_KEY ?? "").trim();
  return conventional === "" ? undefined : conventional;
}

function openAiEngine(direction: VoiceDirection): VoiceEngineSpec {
  return {
    id: "openai",
    direction,
    needsKey: true,
    create: (ctx) => {
      const apiKey = resolveApiKey(ctx.env);
      if (apiKey === undefined) return undefined;
      const baseUrl =
        ctx.baseUrl?.trim() || String(ctx.env.XRK_VOICE_BASE_URL ?? "").trim();
      const voice = ctx.voice?.trim();
      const model = ctx.model?.trim();
      return createOpenAiVoiceProvider({
        apiKey,
        ...(baseUrl === "" ? {} : { baseUrl }),
        ...(voice === undefined || voice === "" ? {} : { defaultVoice: voice }),
        ...(model === undefined || model === "" ? {} : { ttsModel: model }),
        ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
      });
    },
  };
}

const ASR_ENGINES: readonly VoiceEngineSpec[] = [
  {
    id: "local",
    direction: "asr",
    needsKey: false,
    create: (ctx) => createSenseVoiceLocalProvider({ env: ctx.env }),
  },
  openAiEngine("asr"),
  // CI / demo only — reachable through `XRK_VOICE=memory`, never a card value.
  {
    id: "memory",
    direction: "asr",
    needsKey: false,
    create: () => createMemoryVoiceProvider(),
  },
];

const TTS_ENGINES: readonly VoiceEngineSpec[] = [
  // First row is the default: a fresh install with `enabled: true` speaks
  // through Edge (free neural voices, no key). `local` stays registered as the
  // offline fallback for hosts with no network.
  {
    id: "edge",
    direction: "tts",
    needsKey: false,
    create: (ctx) => {
      const voice = ctx.voice?.trim();
      return createEdgeVoiceProvider({
        ...(voice === undefined || voice === "" || voice === EDGE_DEFAULT_VOICE
          ? {}
          : { defaultVoice: voice }),
        ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
      });
    },
  },
  {
    id: "local",
    direction: "tts",
    needsKey: false,
    create: (ctx) => {
      const voice = ctx.voice?.trim();
      return createSystemVoiceProvider({
        env: ctx.env,
        ...(voice === undefined || voice === "" ? {} : { defaultVoice: voice }),
      });
    },
  },
  openAiEngine("tts"),
  {
    id: "memory",
    direction: "tts",
    needsKey: false,
    create: () => createMemoryVoiceProvider(),
  },
];

/**
 * Every engine registered for one direction.
 * @param direction - ASR or TTS.
 * @returns the specs in default order (TTS: edge → local → openai → memory).
 */
export function listVoiceEngines(
  direction: VoiceDirection,
): readonly VoiceEngineSpec[] {
  return direction === "tts" ? TTS_ENGINES : ASR_ENGINES;
}

/** What one access request asks for. */
export interface VoiceAccessRequest {
  readonly direction: VoiceDirection;
  /** Settings engine id (`local` / `openai`). Unknown ids fall back to `local`. */
  readonly engine?: string;
  readonly baseUrl?: string;
  readonly voice?: string;
  readonly model?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Injected Provider (tests / composition) wins over any engine. */
  readonly service?: VoiceService;
  readonly fetchImpl?: typeof fetch;
}

/** The resolved Provider plus the fact a caller may report. */
export interface VoiceAccess {
  readonly service?: VoiceService;
  /** Engine actually used after the `XRK_VOICE` bypass. */
  readonly engine: string;
  /** Tool-facing error when `service` is undefined. */
  readonly unavailableMessage: string;
}

/**
 * Resolve one direction's Provider from Settings + environment.
 *
 * Precedence: injected service → `XRK_VOICE` alias → the requested engine.
 * An id that is not registered for this direction falls back to that
 * direction's local engine, so a stale card value can never brick the tool.
 * @param request - direction, engine id and provider options.
 * @returns the Provider (when resolvable) and the honest failure copy.
 */
export function createVoiceAccess(request: VoiceAccessRequest): VoiceAccess {
  const env = request.env ?? process.env;
  const table = listVoiceEngines(request.direction);
  const requested = resolveEngineId(env, request.engine);
  // `off` is a real answer (Settings has not enabled this direction yet), not
  // an unknown id: it must not fall back to the local engine.
  const spec = requested === "off"
    ? undefined
    : (table.find((row) => row.id === requested) ?? table[0]!);
  const unavailableMessage = voiceUnavailableMessage(env, {
    direction: request.direction,
    engine: spec?.id ?? requested,
  });
  if (spec === undefined) {
    return { engine: "off", unavailableMessage };
  }
  if (request.service) {
    return { service: request.service, engine: spec.id, unavailableMessage };
  }
  const created = spec.create({
      env,
      ...(request.baseUrl ? { baseUrl: request.baseUrl } : {}),
      ...(request.voice ? { voice: request.voice } : {}),
      ...(request.model ? { model: request.model } : {}),
      ...(request.fetchImpl ? { fetchImpl: request.fetchImpl } : {}),
  });
  return {
    ...(created === undefined ? {} : { service: created }),
    engine: spec.id,
    unavailableMessage,
  };
}
