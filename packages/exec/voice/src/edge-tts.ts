/**
 * Edge TTS — Microsoft Edge "Read Aloud" neural voices.
 *
 * Why this engine exists: the Host's OS voices (SAPI / `say` / espeak-ng) are
 * concatenative engines from another era. Edge's Read Aloud endpoint speaks
 * the same neural voices Microsoft ships in Azure Speech, but needs no key,
 * no account and no model download — only a WebSocket. It is the only
 * zero-install TTS worth listening to, and it covers Chinese and English
 * with the same voice set.
 *
 * The trade-off is honestly a trade-off: this is the browser feature's
 * endpoint, not a contracted API. Microsoft has changed the handshake before
 * (Oct 2026) and may again, so `system` stays registered as the offline
 * fallback rather than being replaced.
 *
 * Protocol frame shapes and the Sec-MS-GEC v2 derivation are adapted from
 * `msedge-tts` (MIT) — https://github.com/MiniGlome/msedge-tts. The checksum
 * is not documented by Microsoft; keeping the port close to the reference is
 * what makes a future protocol change cheap to follow.
 */
import { randomUUID } from "node:crypto";
import type http from "node:http";
import WebSocket from "ws";
import { resolveVoiceFetch } from "./proxy-fetch.js";
import { createWsProxyAgent } from "./proxy-ws-agent.js";
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

/** Public token Edge ships in its own client. */
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const VOICES_URL =
  `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;
/** Client build string in the handshake; Edge bumps this, so may we. */
const GEC_VERSION = "2-143.0.3650.96";
/**
 * The endpoint rejects a bare Node handshake with 403. Edge's own client
 * connects from its read-aloud extension origin, so present the same pair.
 * Keep these in sync with {@link GEC_VERSION} when Microsoft ships a new Edge.
 */
const EDGE_HANDSHAKE_HEADERS: Readonly<Record<string, string>> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
  Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
};
const JSON_XML_DELIM = "\r\n\r\n";
const AUDIO_DELIM = "Path:audio\r\n";
const TURN_END = "Path:turn.end";
const DEFAULT_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

/** Chinese female, the voice this product ships as default. */
export const EDGE_DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";

/** One row of the Read Aloud voice catalog. */
export interface EdgeVoice {
  readonly shortName: string;
  readonly gender: string;
  readonly locale: string;
  readonly friendlyName: string;
}

export interface EdgeTtsOptions {
  readonly defaultVoice?: string;
  /** Network seam for tests and gateways. */
  readonly fetchImpl?: typeof fetch;
  /** WebSocket implementation override (tests). */
  readonly webSocketImpl?: typeof WebSocket;
  /**
   * HTTP CONNECT proxy for catalog fetch + synthesis WebSocket
   * (e.g. `http://127.0.0.1:7897`). Empty / omitted = direct.
   */
  readonly proxy?: string;
  /** Connection budget; synthesis inherits a larger one. */
  readonly connectTimeoutMs?: number;
  readonly synthesisTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Sec-MS-GEC v2 — adapted from msedge-tts (MIT). See file header.
// ---------------------------------------------------------------------------

const EDGE_COPYRIGHT =
  "Copyright (C) Microsoft Corporation. All rights reserved.";
const SWAP_FIRST_WORD = {
  swappedWord: 0xef0569fb,
  swappedSum: 0x76f50f34,
  swappedProduct: 0xc3efea97,
};
const SWAP_SECOND_WORD = {
  swappedWord: 0xc31713db,
  swappedSum: 0x1881ce3c,
  swappedProduct: 0x35bd1ec9,
};
const MIX_FIRST_WORD = [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83];
const MIX_SECOND_WORD = [0xa27416f5, 0xd38396ff, 0x7c932b89, 0xbfa49f69];

function swapHalves(value: number): number {
  return ((value << 16) | (value >>> 16)) >>> 0;
}

function swapTerm(
  word: number,
  key: number,
  multipliers: {
    readonly swappedWord: number;
    readonly swappedSum: number;
    readonly swappedProduct: number;
  },
): number {
  const sum =
    Math.imul(word, key) + Math.imul(swapHalves(word), multipliers.swappedWord);
  const product = Math.imul(swapHalves(sum), multipliers.swappedSum) >>> 0;
  return (
    (Math.imul(swapHalves(product), multipliers.swappedProduct) + product) >>> 0
  );
}

function swapAndMultiply(value: number, multipliers: readonly number[]): number {
  let next = value;
  for (const multiplier of multipliers) {
    next = Math.imul(swapHalves(next), multiplier) >>> 0;
  }
  return next;
}

function cs64(message: Uint8Array, digest: Uint8Array): Uint8Array {
  const digestView = new DataView(
    digest.buffer,
    digest.byteOffset,
    digest.byteLength,
  );
  const firstKey = (digestView.getUint32(0, true) | 1) >>> 0;
  const secondKey = (digestView.getUint32(4, true) | 1) >>> 0;
  const padded = new Uint8Array(Math.ceil(message.length / 8) * 8);
  padded.set(message);
  const words = new DataView(padded.buffer);
  let swapSum = 0;
  let lastSwap = 0;
  let mix = 0;
  let mixSum = 0;
  for (let offset = 0; offset < padded.length; offset += 8) {
    const firstWord = words.getUint32(offset, true);
    const secondWord = words.getUint32(offset + 4, true);
    const firstSwap = swapTerm(firstWord, firstKey, SWAP_FIRST_WORD);
    lastSwap = swapTerm(secondWord, secondKey, SWAP_SECOND_WORD);
    swapSum = (swapSum + firstSwap + lastSwap) >>> 0;
    mix = swapAndMultiply(
      Math.imul(mix + firstWord, firstKey),
      MIX_FIRST_WORD,
    );
    mixSum = (mixSum + mix) >>> 0;
    mix = swapAndMultiply(
      Math.imul(mix + secondWord, secondKey),
      MIX_SECOND_WORD,
    );
    mixSum = (mixSum + mix) >>> 0;
  }
  const checksum = new Uint8Array(8);
  const view = new DataView(checksum.buffer);
  view.setUint32(0, lastSwap ^ mix, true);
  view.setUint32(4, swapSum ^ mixSum, true);
  return checksum;
}

function upperHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * `Sec-MS-GEC` is `<CS64 checksum>-<SHA-256>` over Edge's copyright line plus
 * the Windows-tick timestamp and token.
 */
export async function hashSecMsGecV2(ticksAndToken: string): Promise<string> {
  const message = new TextEncoder().encode(EDGE_COPYRIGHT + ticksAndToken);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", message),
  );
  return `${upperHex(cs64(message, digest))}-${upperHex(digest)}`;
}

/** Ticks rounded to five minutes, matching the Edge client's cadence. */
async function generateSecMsGec(
  token: string,
  now: number = Date.now(),
): Promise<string> {
  const ticks = Math.floor(now / 1000) + 11644473600;
  const rounded = ticks - (ticks % 300);
  const windowsTicks = rounded * 10000000;
  return hashSecMsGecV2(`${windowsTicks}${token}`);
}

// ---------------------------------------------------------------------------
// SSML + socket
// ---------------------------------------------------------------------------

function voiceLocale(voice: string): string {
  const match = /\b([a-z]{2,}-[A-Z]{2})\b/.exec(voice);
  return match?.[1] ?? "en-US";
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function ssmlFor(text: string, voice: string): string {
  const lang = voiceLocale(voice);
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xml:lang="${lang}"><voice name="${voice}">` +
    `<prosody pitch="+0Hz" rate="+0%" volume="+0%">${escapeXml(text)}</prosody>` +
    `</voice></speak>`
  );
}

interface EdgeSynthesisInput {
  readonly text: string;
  readonly voice: string;
  readonly outputFormat: string;
  /** Pre-derived `Sec-MS-GEC` for this five-minute bucket. */
  readonly gec: string;
  readonly connectTimeoutMs: number;
  readonly synthesisTimeoutMs: number;
  readonly webSocketImpl: typeof WebSocket;
  /** Optional CONNECT agent for `wss` through an operator proxy. */
  readonly agent?: http.Agent;
}

/**
 * One synthesis over one socket. Resolves with the concatenated audio frames;
 * rejects on handshake failure, socket error, or a synthesis timeout.
 */
function synthesizeOverSocket(input: EdgeSynthesisInput): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const connectionId = randomUUID();
    const requestId = randomUUID().replaceAll("-", "");
    let settled = false;
    // One clock per phase, held as object properties: a `let` pair is what
    // prefer-const rejects, and a plain Set cannot express "re-arm the same
    // clock" (the synth deadline is pushed back on every audio frame).
    const clocks: { connect?: NodeJS.Timeout; synth?: NodeJS.Timeout } = {};
    const chunks: Uint8Array[] = [];

    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      if (clocks.connect) clearTimeout(clocks.connect);
      if (clocks.synth) clearTimeout(clocks.synth);
      try {
        // `close()` starts a graceful handshake and can leave a half-open
        // socket (and its keepalive timer) behind; `terminate()` drops it now,
        // so a one-shot CLI or test process actually exits.
        const closable = socket as unknown as {
          terminate?: () => void;
          close?: () => void;
        };
        if (typeof closable.terminate === "function") closable.terminate();
        else closable.close?.();
      } catch {
        /* already closing */
      }
      if (err) reject(err);
      else resolve(concat(chunks));
    };

    const socket = new input.webSocketImpl(urlFor(connectionId, input.gec), {
      headers: EDGE_HANDSHAKE_HEADERS,
      ...(input.agent ? { agent: input.agent } : {}),
    });

    clocks.connect = setTimeout(() => {
      finish(
        new VoiceError(
          `edge tts connect timed out after ${input.connectTimeoutMs}ms`,
          "VOICE_BACKEND",
        ),
      );
    }, input.connectTimeoutMs);

    socket.on("open", () => {
      if (settled) return;
      if (clocks.connect) clearTimeout(clocks.connect);
      clocks.synth = setTimeout(() => {
        finish(
          new VoiceError(
            `edge tts synthesis timed out after ${input.synthesisTimeoutMs}ms`,
            "VOICE_BACKEND",
          ),
        );
      }, input.synthesisTimeoutMs);
      socket.send(speechConfig(input.outputFormat));
      socket.send(ssmlFrame(requestId, ssmlFor(input.text, input.voice)));
    });

    socket.on("message", (data, isBinary) => {
      if (settled) return;
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (!isBinary) {
        const text = buf.toString("utf8");
        if (text.includes(TURN_END)) finish();
        return;
      }
      const headerEnd = buf.indexOf(AUDIO_DELIM);
      if (headerEnd < 0) return;
      chunks.push(buf.subarray(headerEnd + AUDIO_DELIM.length));
      if (clocks.synth) {
        clearTimeout(clocks.synth);
        clocks.synth = setTimeout(() => {
          finish(
            new VoiceError(
              `edge tts synthesis timed out after ${input.synthesisTimeoutMs}ms`,
              "VOICE_BACKEND",
            ),
          );
        }, input.synthesisTimeoutMs);
      }
    });

    socket.on("error", (err: Error) => {
      finish(new VoiceError(`edge tts socket: ${err.message}`, "VOICE_BACKEND"));
    });

    socket.on("close", () => {
      // A close before `turn.end` still delivers whatever audio arrived; only
      // an empty body means the handshake was rejected.
      finish(chunks.length > 0 ? undefined : new VoiceError(
        "edge tts closed before audio (handshake rejected or voice unavailable)",
        "VOICE_BACKEND",
      ));
    });
  });
}

function urlFor(connectionId: string, gec: string): string {
  return `${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${encodeURIComponent(gec)}` +
    `&Sec-MS-GEC-Version=${GEC_VERSION}` +
    `&ConnectionId=${connectionId}`;
}

function speechConfig(outputFormat: string): string {
  const payload = JSON.stringify({
    context: {
      synthesis: {
        audio: {
          metadataoptions: {
            sentenceBoundaryEnabled: "false",
            wordBoundaryEnabled: "false",
          },
          outputFormat,
        },
      },
    },
  });
  return (
    `Content-Type:application/json; charset=utf-8\r\n` +
    `Path:speech.config${JSON_XML_DELIM}${payload}`
  );
}

function ssmlFrame(requestId: string, ssml: string): string {
  return (
    `X-RequestId:${requestId}\r\n` +
    `Content-Type:application/ssml+xml\r\n` +
    `Path:ssml${JSON_XML_DELIM}${ssml}`
  );
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Sec-MS-GEC is expensive enough (SHA-256 + checksum over a long string) that
 * re-deriving it per request would be waste; it also only changes every five
 * minutes. Cache one value per five-minute bucket.
 */
const gecCache: { value: string; bucket: number } = { value: "", bucket: -1 };

async function currentGec(now: number = Date.now()): Promise<string> {
  const bucket = Math.floor(now / 1000 / 300);
  if (gecCache.bucket === bucket && gecCache.value !== "") {
    return gecCache.value;
  }
  const value = await generateSecMsGec(TRUSTED_CLIENT_TOKEN, now);
  gecCache.value = value;
  gecCache.bucket = bucket;
  return value;
}

// ---------------------------------------------------------------------------
// Voice catalog
// ---------------------------------------------------------------------------

/**
 * Fetch the Read Aloud voice catalog.
 *
 * The card filters this by locale; the list is stable enough to cache for a
 * day on the Host, but this function stays a plain fetch so callers decide.
 */
export async function listEdgeVoices(
  options: Pick<EdgeTtsOptions, "fetchImpl" | "proxy"> = {},
): Promise<readonly EdgeVoice[]> {
  const fetchImpl = resolveVoiceFetch({
    ...(options.proxy ? { proxy: options.proxy } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  const res = await fetchImpl(VOICES_URL);
  if (!res.ok) {
    throw new VoiceError(
      `edge voices HTTP ${res.status}`,
      "VOICE_BACKEND",
    );
  }
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  const out: EdgeVoice[] = [];
  for (const row of rows) {
    const shortName = String(row.ShortName ?? "").trim();
    if (shortName === "") continue;
    out.push({
      shortName,
      gender: String(row.Gender ?? ""),
      locale: String(row.Locale ?? ""),
      friendlyName: String(row.FriendlyName ?? shortName),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface EdgeVoiceProviderOptions extends EdgeTtsOptions {
  readonly now?: () => number;
}

/**
 * Build the Edge TTS Provider.
 *
 * `transcribe` / `createLiveSession` are honestly unsupported: Edge has no
 * STT and no realtime session, and pretending otherwise would make ASR
 * cards silently point at nothing.
 */
export function createEdgeVoiceProvider(
  options: EdgeVoiceProviderOptions = {},
): VoiceService {
  const webSocketImpl = options.webSocketImpl ?? WebSocket;
  const defaultVoice = options.defaultVoice?.trim() || EDGE_DEFAULT_VOICE;
  const connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
  const synthesisTimeoutMs = options.synthesisTimeoutMs ?? 30_000;
  const proxy = options.proxy?.trim() || "";

  return {
    async synthesize(req: VoiceSynthesizeRequest): Promise<VoiceSynthesizeResult> {
      const text = String(req.text ?? "").trim();
      if (text === "") {
        throw new VoiceError("synthesize text is empty", "VOICE_BAD_ARGS");
      }
      // Edge always streams MP3 regardless of the requested container; say so
      // instead of returning WAV bytes under a WAV mime.
      const voice = req.voice?.trim() || defaultVoice;
      const gec = await currentGec(options.now?.() ?? Date.now());
      const agent = proxy ? createWsProxyAgent(proxy) : undefined;
      const bytes = await synthesizeOverSocket({
        text,
        voice,
        outputFormat: DEFAULT_OUTPUT_FORMAT,
        gec,
        connectTimeoutMs,
        synthesisTimeoutMs,
        webSocketImpl,
        ...(agent ? { agent } : {}),
      });
      if (bytes.length === 0) {
        throw new VoiceError(
          `edge tts returned no audio for voice ${voice}`,
          "VOICE_BACKEND",
        );
      }
      return {
        bytes,
        mimeType: "audio/mpeg",
        provider: "edge",
        delivery: "edge",
        voice,
        note: `edge-tts bytes=${bytes.length} voice=${voice}`,
      };
    },

    async transcribe(_req: VoiceTranscribeRequest): Promise<VoiceTranscribeResult> {
      throw new VoiceError(
        "Edge TTS is synthesis-only; use the local or openai engine for dictation",
        "VOICE_UNAVAILABLE",
      );
    },

    async createLiveSession(
      _req: VoiceLiveCreateRequest,
    ): Promise<VoiceLiveCreateResult> {
      throw new VoiceError(
        "Edge TTS has no realtime session; use the openai engine for live voice",
        "VOICE_LIVE_UNSUPPORTED",
      );
    },

    liveStatus(): VoiceLiveStatus {
      return {
        available: false,
        mode: "none",
        provider: "edge",
        reason: "TTS-only engine (no dictation / realtime session)",
      };
    },
  };
}

/** Voices for one locale prefix (`zh-CN`, `en-US`, …); empty means all. */
export function filterEdgeVoices(
  voices: readonly EdgeVoice[],
  localePrefix?: string,
): readonly EdgeVoice[] {
  const prefix = localePrefix?.trim().toLowerCase();
  if (prefix === undefined || prefix === "") return voices;
  return voices.filter((voice) => voice.locale.toLowerCase().startsWith(prefix));
}

/** Exposed for the voice catalog test: pure, no network. */
export const edgeTtsInternals = {
  hashSecMsGecV2,
  ssmlFor,
  speechConfig,
  voiceLocale,
  escapeXml,
} as const;
