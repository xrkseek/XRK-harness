import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createSystemVoiceProvider,
  createMemoryVoiceProvider,
  createOpenAiVoiceProvider,
  createSenseVoiceLocalProvider,
  createSpeakTool,
  createVoiceAccess,
  createVoiceTools,
  describeVoiceAccess,
  inspectSenseVoiceAssets,
  listSystemVoices,
  minimalWavBytes,
  voicePromptText,
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

  it("surface binds exactly one switch's half", () => {
    // `tts.enabled` owns text_to_speech; `asr.enabled` owns the listen half.
    // Neither switch may drag the other switch's tool into the surface.
    expect(
      createVoiceTools({ env: {}, surface: "speak" }).map((tool) => tool.name),
    ).toEqual(["text_to_speech"]);
    expect(
      createVoiceTools({ env: {}, surface: "listen" }).map((tool) => tool.name),
    ).toEqual(["voice_transcribe", "voice_session"]);
  });

  it("prompt blocks name only the tools that are bound", () => {
    expect(voicePromptText(() => false)).toBe("");
    const speakOnly = voicePromptText((name) => name === "text_to_speech");
    expect(speakOnly).toContain("text_to_speech");
    expect(speakOnly).not.toContain("voice_transcribe");
    const listenOnly = voicePromptText((name) => name === "voice_transcribe");
    expect(listenOnly).toContain("voice_transcribe");
    expect(listenOnly).not.toContain("text_to_speech");
  });

  it("describeVoiceAccess shares facts with tool errors", () => {
    expect(describeVoiceAccess({}, { direction: "asr" }).kind).toBe("off");
    expect(describeVoiceAccess({}, { direction: "asr" }).ready).toBe(false);
    expect(
      describeVoiceAccess({}, { direction: "asr", engine: "openai" }).kind,
    ).toBe("openai-missing-key");
    expect(
      describeVoiceAccess(
        { XRK_VOICE_OPENAI_KEY: "sk" },
        { direction: "asr", engine: "openai" },
      ).kind,
    ).toBe("openai-ready");
    expect(
      describeVoiceAccess({ XRK_VOICE: "memory" }, { direction: "asr" }).kind,
    ).toBe("memory");
    expect(
      describeVoiceAccess({ XRK_VOICE: "local" }, { direction: "asr" }).kind,
    ).toBe("local");
    expect(
      describeVoiceAccess({}, { direction: "asr", engine: "local" }).kind,
    ).toBe("local");
    // The same `local` id means OS voices on the TTS side.
    expect(
      describeVoiceAccess({}, { direction: "tts", engine: "local" }).kind,
    ).toBe("system");
  });

  it("SenseVoice local inspect + honest STT without assets/sherpa", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-sv-"));
    try {
      const empty = inspectSenseVoiceAssets({ dataRoot: root });
      expect(empty.ready).toBe(false);
      expect(empty.missing.length).toBeGreaterThan(0);

      const unprepared = createSenseVoiceLocalProvider({ dataRoot: root });
      await expect(
        unprepared.transcribe({ bytes: minimalWavBytes() }),
      ).rejects.toThrow(/not prepared|Missing/i);

      writeFileSync(path.join(root, "model.int8.onnx"), "x");
      writeFileSync(path.join(root, "tokens.txt"), "x");
      writeFileSync(path.join(root, "silero_vad.onnx"), "x");
      expect(inspectSenseVoiceAssets({ dataRoot: root }).ready).toBe(true);

      const voice = createSenseVoiceLocalProvider({ dataRoot: root });
      const spoken = await voice.synthesize({ text: "hi" });
      expect(spoken.delivery).toBe("local");
      // Assets ready; CI typically lacks sherpa-onnx-node (or empty WAV fails PCM).
      await expect(
        voice.transcribe({ bytes: minimalWavBytes() }),
      ).rejects.toThrow(/sherpa-onnx-node|WAV|no PCM|SenseVoice|Please check your config/i);
      expect(voice.liveStatus().available).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("createVoiceAccess resolves local SenseVoice for ASR", () => {
    expect(
      createVoiceAccess({
        direction: "asr",
        env: { XRK_VOICE: "local" },
      }).service,
    ).toBeTruthy();
    expect(
      createVoiceAccess({
        direction: "asr",
        engine: "local",
        env: {},
      }).service,
    ).toBeTruthy();
  });

  it("system TTS renders through the platform command", async () => {
    const calls: { file: string; args: readonly string[] }[] = [];
    const provider = createSystemVoiceProvider({
      platform: "linux",
      defaultVoice: "en",
      run: async (file, args) => {
        calls.push({ file, args });
        const out = args[args.indexOf("-w") + 1]!;
        writeFileSync(out, minimalWavBytes());
        return "";
      },
    });
    const spoken = await provider.synthesize({ text: "你好" });
    expect(spoken.delivery).toBe("system");
    expect(spoken.mimeType).toBe("audio/wav");
    expect(spoken.bytes.byteLength).toBeGreaterThan(0);
    expect(calls[0]?.file).toBe("espeak-ng");
    expect(calls[0]?.args).toContain("-v");
    expect(provider.liveStatus().available).toBe(false);
  });

  it("listSystemVoices parses each backend's output", async () => {
    expect(
      await listSystemVoices({
        platform: "darwin",
        run: async () => "Alex                en_US    # Most people recognize me by my voice.\n",
      }),
    ).toEqual([{ id: "Alex", label: "Alex (en_US)" }]);
    expect(
      await listSystemVoices({
        platform: "linux",
        run: async () =>
          "Pty Language Age/Gender VoiceName          File          Other Languages\n" +
          " 5  en             --/--  english            en            (en)\n",
      }),
    ).toEqual([{ id: "english", label: "english (en)" }]);
    // A failed probe is an empty list, not an error.
    expect(
      await listSystemVoices({
        platform: "darwin",
        run: async () => {
          throw new Error("boom");
        },
      }),
    ).toEqual([]);
  });

  it("createVoiceAccess resolves local TTS to the OS-voice Provider", () => {
    const access = createVoiceAccess({
      direction: "tts",
      engine: "local",
      voice: "en",
      env: {},
    });
    expect(access.engine).toBe("local");
    expect(access.service).toBeTruthy();
  });

  it("createSpeakTool is text_to_speech only", async () => {
    const speak = createSpeakTool({
      service: createMemoryVoiceProvider(),
      env: { XRK_VOICE: "memory" },
    });
    expect(speak.name).toBe("text_to_speech");
    const out = await speak.execute({ text: "ping" });
    expect(out.isError).toBeFalsy();
    expect(out.content).toMatch(/provider=memory/);
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

  it("createVoiceAccess resolves memory and openai", async () => {
    expect(
      createVoiceAccess({ direction: "asr", engine: "local", env: {} }).service,
    ).toBeTruthy();
    expect(
      createVoiceAccess({
        direction: "asr",
        engine: "local",
        env: { XRK_VOICE: "memory" },
      }).service,
    ).toBeTruthy();
    expect(
      createVoiceAccess({
        direction: "asr",
        engine: "openai",
        env: { XRK_VOICE: "1" },
      }).service,
    ).toBeUndefined();

    expect(
      createVoiceAccess({
        direction: "asr",
        engine: "openai",
        env: {},
      }).service,
    ).toBeUndefined();
    expect(
      createVoiceAccess({
        direction: "asr",
        engine: "openai",
        env: { XRK_VOICE_OPENAI_KEY: "sk-product" },
      }).service,
    ).toBeTruthy();
    // Env CI bypass wins over the Settings engine.
    expect(
      createVoiceAccess({
        direction: "asr",
        engine: "openai",
        env: { XRK_VOICE: "memory" },
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

    const access = createVoiceAccess({
      direction: "tts",
      engine: "openai",
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
