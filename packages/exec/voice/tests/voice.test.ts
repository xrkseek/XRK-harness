import { describe, expect, it } from "vitest";
import {
  createDefaultVoiceAccess,
  createMemoryVoiceProvider,
  createOpenAiVoiceProvider,
  createVoiceTools,
  describeVoiceAccess,
  minimalWavBytes,
} from "../src/index.js";

describe("exec-voice", () => {
  it("memory provider covers TTS · STT · live", async () => {
    const voice = createMemoryVoiceProvider({ transcript: "hello world" });
    const spoken = await voice.synthesize({ text: "hi there" });
    expect(spoken.provider).toBe("memory");
    expect(spoken.bytes.byteLength).toBeGreaterThan(0);

    const heard = await voice.transcribe({ bytes: minimalWavBytes() });
    expect(heard.text).toBe("hello world");

    const live = await voice.createLiveSession({ sdpOffer: "v=0" });
    expect(live.sessionId).toMatch(/^voice_mem_/);
    expect(live.sdpAnswer).toBeTruthy();
    expect(voice.liveStatus().available).toBe(true);
  });

  it("tools fail honestly without Provider", async () => {
    const tools = createVoiceTools({ env: {} });
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "text_to_speech",
      "voice_session",
      "voice_transcribe",
    ]);
    const out = await tools[0]!.execute({ text: "hi" });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/XRK_VOICE/);
  });

  it("describeVoiceAccess shares facts with tool errors", () => {
    expect(describeVoiceAccess({}).kind).toBe("off");
    expect(describeVoiceAccess({}).ready).toBe(false);
    expect(
      describeVoiceAccess({}, { mode: "openai" }).kind,
    ).toBe("openai-missing-key");
    expect(
      describeVoiceAccess(
        { XRK_VOICE_OPENAI_KEY: "sk" },
        { mode: "openai" },
      ).kind,
    ).toBe("openai-ready");
    expect(describeVoiceAccess({ XRK_VOICE: "memory" }).kind).toBe("memory");
  });

  it("tools work with memory Provider", async () => {
    const tools = createVoiceTools({
      service: createMemoryVoiceProvider(),
      env: { XRK_VOICE: "memory" },
    });
    const tts = tools.find((t) => t.name === "text_to_speech")!;
    const out = await tts.execute({ text: "ping" });
    expect(out.isError).toBeFalsy();
    expect(out.content).toMatch(/provider=memory/);
    expect(out.content).toMatch(/audio_base64=/);

    const stt = tools.find((t) => t.name === "voice_transcribe")!;
    const b64 = Buffer.from(minimalWavBytes()).toString("base64");
    const heard = await stt.execute({ audio_base64: b64 });
    expect(heard.isError).toBeFalsy();
    expect(heard.content).toMatch(/\[memory-stt\]/);

    const live = tools.find((t) => t.name === "voice_session")!;
    const status = await live.execute({ action: "status" });
    expect(status.content).toMatch(/available=true/);
    const created = await live.execute({ action: "create" });
    expect(created.content).toMatch(/sessionId=voice_mem_/);
  });

  it("createDefaultVoiceAccess resolves memory and openai", async () => {
    expect(createDefaultVoiceAccess({ env: {} }).service).toBeUndefined();
    expect(
      createDefaultVoiceAccess({ env: { XRK_VOICE: "memory" } }).service,
    ).toBeTruthy();
    expect(
      createDefaultVoiceAccess({
        env: { XRK_VOICE: "1" },
      }).service,
    ).toBeUndefined();

    expect(
      createDefaultVoiceAccess({
        env: {},
        product: { mode: "openai" },
      }).service,
    ).toBeUndefined();
    expect(
      createDefaultVoiceAccess({
        env: { XRK_VOICE_OPENAI_KEY: "sk-product" },
        product: { mode: "openai" },
      }).service,
    ).toBeTruthy();
    // Env CI bypass wins over product off.
    expect(
      createDefaultVoiceAccess({
        env: { XRK_VOICE: "memory" },
        product: { mode: "off" },
      }).service,
    ).toBeTruthy();

    const calls: string[] = [];
    const service = createOpenAiVoiceProvider({
      apiKey: "sk-test",
      fetchImpl: async (input) => {
        calls.push(String(input));
        const url = String(input);
        if (url.includes("audio/speech")) {
          return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
        }
        if (url.includes("audio/transcriptions")) {
          return Response.json({ text: "from-api" });
        }
        if (url.includes("realtime/sessions")) {
          return Response.json({
            id: "sess_1",
            client_secret: { value: "ek_test" },
          });
        }
        return new Response("nope", { status: 404 });
      },
    });
    const spoken = await service.synthesize({ text: "a" });
    expect(spoken.bytes).toEqual(new Uint8Array([1, 2, 3]));
    const heard = await service.transcribe({ bytes: minimalWavBytes() });
    expect(heard.text).toBe("from-api");
    const live = await service.createLiveSession({});
    expect(live.sessionId).toBe("sess_1");
    expect(live.clientSecret).toBe("ek_test");
    expect(calls.some((u) => u.includes("audio/speech"))).toBe(true);

    const access = createDefaultVoiceAccess({
      env: {
        XRK_VOICE: "1",
        OPENAI_API_KEY: "sk-x",
      },
      fetchImpl: async () =>
        new Response(new Uint8Array([9]), { status: 200 }),
    });
    expect(access.service).toBeTruthy();
    const out = await access.service!.synthesize({ text: "z" });
    expect(out.delivery).toBe("openai");
  });
});
