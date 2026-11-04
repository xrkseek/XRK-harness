import { describe, expect, it } from "vitest";
import {
  createEdgeVoiceProvider,
  EDGE_DEFAULT_VOICE,
  edgeTtsInternals,
  filterEdgeVoices,
  listEdgeVoices,
  type EdgeVoice,
} from "../src/edge-tts.ts";

const { hashSecMsGecV2, ssmlFor, speechConfig, voiceLocale, escapeXml } =
  edgeTtsInternals;

describe("edge tts sec-ms-gec", () => {
  it("is deterministic for one tick string", async () => {
    const a = await hashSecMsGecV2("132999999990000000TOKEN");
    const b = await hashSecMsGecV2("132999999990000000TOKEN");
    expect(a).toBe(b);
    // `<CS64 8 bytes hex>-<SHA256 32 bytes hex>`
    expect(a).toMatch(/^[0-9A-F]{16}-[0-9A-F]{64}$/);
  });

  it("changes when the tick bucket changes", async () => {
    const a = await hashSecMsGecV2("132999999990000000TOKEN");
    const b = await hashSecMsGecV2("132999999990300000TOKEN");
    expect(a).not.toBe(b);
  });
});

describe("edge tts ssml", () => {
  it("derives the xml:lang from the voice name", () => {
    expect(voiceLocale("zh-CN-XiaoxiaoNeural")).toBe("zh-CN");
    expect(voiceLocale("en-US-AriaNeural")).toBe("en-US");
    expect(voiceLocale("no-locale")).toBe("en-US");
  });

  it("escapes text so the SSML stays well-formed", () => {
    expect(escapeXml(`a & b <c> "d" 'e'`)).toBe(
      "a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;",
    );
    const ssml = ssmlFor("<script>", "zh-CN-XiaoxiaoNeural");
    expect(ssml).toContain("&lt;script&gt;");
    expect(ssml).toContain('xml:lang="zh-CN"');
  });

  it("carries the requested output format in speech.config", () => {
    const config = speechConfig("audio-24khz-48kbitrate-mono-mp3");
    expect(config).toContain("Path:speech.config");
    expect(config).toContain('"outputFormat":"audio-24khz-48kbitrate-mono-mp3"');
  });
});

describe("edge tts voices", () => {
  const rows = [
    { ShortName: "zh-CN-XiaoxiaoNeural", Gender: "Female", Locale: "zh-CN", FriendlyName: "Xiaoxiao" },
    { ShortName: "en-US-AriaNeural", Gender: "Female", Locale: "en-US", FriendlyName: "Aria" },
    { ShortName: "", Gender: "Female", Locale: "en-US" },
  ];

  it("parses the Read Aloud catalog and drops empty rows", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify(rows), { status: 200 })) as unknown as typeof fetch;
    const voices = await listEdgeVoices({ fetchImpl });
    expect(voices.map((v) => v.shortName)).toEqual([
      "zh-CN-XiaoxiaoNeural",
      "en-US-AriaNeural",
    ]);
  });

  it("filters by locale prefix", () => {
    const voices: EdgeVoice[] = [
      { shortName: "zh-CN-XiaoxiaoNeural", gender: "Female", locale: "zh-CN", friendlyName: "X" },
      { shortName: "en-US-AriaNeural", gender: "Female", locale: "en-US", friendlyName: "A" },
    ];
    expect(filterEdgeVoices(voices, "zh").map((v) => v.shortName)).toEqual([
      "zh-CN-XiaoxiaoNeural",
    ]);
    expect(filterEdgeVoices(voices).length).toBe(2);
  });
});

/** Minimal ws-shaped socket the provider can drive without network. */
class FakeSocket {
  private readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  readonly sent: string[] = [];
  closed = false;

  on(event: string, fn: (...args: unknown[]) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(fn);
    this.handlers.set(event, list);
    return this;
  }

  send(data: string): void {
    this.sent.push(data);
    if (data.includes("Path:ssml")) {
      // One audio frame, then turn.end — the provider's happy path.
      queueMicrotask(() => {
        this.emit(
          "message",
          Buffer.concat([Buffer.from("Path:audio\r\n"), Buffer.from("MP3BYTES")]),
          true,
        );
        this.emit("message", Buffer.from("Path:turn.end\r\n"), false);
      });
    }
  }

  close(): void {
    this.closed = true;
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const fn of this.handlers.get(event) ?? []) fn(...args);
  }
}

describe("edge tts provider", () => {
  it("synthesizes mp3 bytes through the socket protocol", async () => {
    const sockets: FakeSocket[] = [];
    const provider = createEdgeVoiceProvider({
      webSocketImpl: function () {
        const socket = new FakeSocket();
        sockets.push(socket);
        // The provider attaches handlers synchronously after construction.
        queueMicrotask(() => {
          for (const fn of (socket as unknown as { handlers: Map<string, Array<() => void>> }).handlers.get("open") ?? []) fn();
        });
        return socket as unknown as never;
      } as unknown as typeof import("ws").default,
    });
    const result = await provider.synthesize({ text: "你好" });
    expect(result.provider).toBe("edge");
    expect(result.delivery).toBe("edge");
    expect(result.mimeType).toBe("audio/mpeg");
    expect(Buffer.from(result.bytes).toString()).toBe("MP3BYTES");
    expect(sockets[0]?.sent.some((f) => f.includes("Path:ssml"))).toBe(true);
    expect(sockets[0]?.closed).toBe(true);
  });

  it("refuses dictation and live sessions honestly", async () => {
    const provider = createEdgeVoiceProvider({});
    await expect(
      provider.transcribe({ bytes: new Uint8Array([1]) }),
    ).rejects.toThrow(/synthesis-only/);
    await expect(provider.createLiveSession({})).rejects.toThrow(
      /no realtime session/,
    );
    expect(provider.liveStatus().available).toBe(false);
  });

  it("uses Xiaoxiao when the caller names no voice", async () => {
    expect(EDGE_DEFAULT_VOICE).toBe("zh-CN-XiaoxiaoNeural");
  });
});
