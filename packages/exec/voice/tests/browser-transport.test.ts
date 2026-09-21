import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RECORDER_MIME_CANDIDATES,
  createBrowserVoiceTransport,
  encodeBase64,
  micCapabilities,
  pickRecorderMime,
  startDictation,
  startVoiceSession,
  type BrowserVoiceDeps,
  type VoiceBlob,
  type VoiceMediaRecorder,
  type VoiceMediaStream,
  type VoicePeerConnection,
  type VoiceSessionDescription,
} from "../src/browser/index.js";

/* ------------------------------------------------------------------ fakes */

function fakeBlob(text: string, type: string): VoiceBlob {
  const bytes = new TextEncoder().encode(text);
  return {
    size: bytes.length,
    type,
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

/** Mic stream whose track stops are observable. */
interface MicProbe {
  readonly stream: VoiceMediaStream;
  readonly stops: number;
}

function micStream(): MicProbe {
  const state = { stops: 0 };
  return {
    stream: {
      getTracks: () => [
        {
          stop: () => {
            state.stops += 1;
          },
        },
      ],
    },
    get stops() {
      return state.stops;
    },
  };
}

class FakeRecorder implements VoiceMediaRecorder {
  static instances: FakeRecorder[] = [];
  static supports: readonly string[] | undefined;
  static chunks: readonly string[] = ["hello"];
  static failOnStop = false;

  readonly mimeType: string;
  state = "inactive";
  ondataavailable: ((event: { data: VoiceBlob }) => void) | null = null;
  onstop: ((event?: unknown) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  startedWith: number | undefined;

  constructor(_stream: VoiceMediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    FakeRecorder.instances.push(this);
  }

  static isTypeSupported(mimeType: string): boolean {
    return (FakeRecorder.supports ?? []).includes(mimeType);
  }

  start(timeslice?: number): void {
    this.startedWith = timeslice;
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    if (FakeRecorder.failOnStop) {
      this.onerror?.({ name: "UnknownError" });
      return;
    }
    for (const payload of FakeRecorder.chunks) {
      this.ondataavailable?.({ data: fakeBlob(payload, this.mimeType) });
    }
    this.onstop?.();
  }
}

class FakePeerConnection implements VoicePeerConnection {
  static instances: FakePeerConnection[] = [];

  connectionState = "new";
  localDescription: VoiceSessionDescription | null = null;
  onconnectionstatechange: ((event?: unknown) => void) | null = null;
  readonly added: unknown[] = [];
  remote: VoiceSessionDescription | null = null;
  closed = false;

  constructor(readonly config?: unknown) {
    FakePeerConnection.instances.push(this);
  }

  addTrack(track: unknown): unknown {
    this.added.push(track);
    return track;
  }

  async createOffer(): Promise<VoiceSessionDescription> {
    return { type: "offer", sdp: "v=0\r\ns=test-offer" };
  }

  async setLocalDescription(description: VoiceSessionDescription) {
    this.localDescription = description;
  }

  async setRemoteDescription(description: VoiceSessionDescription) {
    this.remote = description;
  }

  close(): void {
    this.closed = true;
  }
}

function micDeps(overrides: Partial<BrowserVoiceDeps> = {}): BrowserVoiceDeps {
  return {
    getUserMedia: async () => micStream().stream,
    MediaRecorder: FakeRecorder as unknown as BrowserVoiceDeps["MediaRecorder"],
    PeerConnection: FakePeerConnection as unknown as BrowserVoiceDeps["PeerConnection"],
    ...overrides,
  };
}

beforeEach(() => {
  FakeRecorder.instances = [];
  // Model a real browser: the recorder advertises opus/webm support.
  FakeRecorder.supports = ["audio/webm;codecs=opus"];
  FakeRecorder.chunks = ["hello"];
  FakeRecorder.failOnStop = false;
  FakePeerConnection.instances = [];
});

/* ------------------------------------------------------------- container */

describe("pickRecorderMime", () => {
  it("prefers the first supported candidate", () => {
    expect(pickRecorderMime(() => true)).toBe(RECORDER_MIME_CANDIDATES[0]);
    expect(pickRecorderMime((m) => m === "audio/mp4")).toBe("audio/mp4");
  });

  it("defaults to webm/opus with no probe and yields undefined when unsupported", () => {
    expect(pickRecorderMime()).toBe("audio/webm;codecs=opus");
    expect(pickRecorderMime(() => false)).toBeUndefined();
  });
});

describe("encodeBase64", () => {
  it("encodes bytes through the injected btoa", () => {
    const btoa = (s: string) => Buffer.from(s, "binary").toString("base64");
    const bytes = new TextEncoder().encode("hello");
    expect(encodeBase64(bytes, btoa)).toBe("aGVsbG8=");
  });

  it("survives payloads larger than the chunk size", () => {
    const btoa = (s: string) => Buffer.from(s, "binary").toString("base64");
    const bytes = new Uint8Array(70_000).fill(65);
    const out = encodeBase64(bytes, btoa);
    expect(Buffer.from(out, "base64").toString("binary")).toBe(
      Buffer.alloc(70_000, 65).toString("binary"),
    );
  });
});

/* -------------------------------------------------------------- dictation */

describe("startDictation", () => {
  it("records, stops tracks and reports bytes · mime · duration", async () => {
    const mic = micStream();
    let clock = 1_000;
    const recorder = await startDictation({
      deps: micDeps({
        getUserMedia: async () => mic.stream,
      }),
      now: () => clock,
    });

    expect(recorder.isRecording()).toBe(true);
    clock = 1_250;
    const result = await recorder.stop();

    expect(new TextDecoder().decode(result.bytes)).toBe("hello");
    expect(result.mimeType).toBe("audio/webm;codecs=opus");
    expect(result.durationMs).toBe(250);
    expect(recorder.isRecording()).toBe(false);
    expect(mic.stops).toBe(1);
    expect(FakeRecorder.instances[0]?.startedWith).toBeUndefined();
  });

  it("negotiates past unsupported containers", async () => {
    FakeRecorder.supports = ["audio/mp4"];
    await startDictation({ deps: micDeps() });
    expect(FakeRecorder.instances[0]?.mimeType).toBe("audio/mp4");
  });

  it("honours an explicit mimeType and a timeslice", async () => {
    await startDictation({
      deps: micDeps(),
      mimeType: "audio/ogg;codecs=opus",
      timesliceMs: 250,
    });
    const rec = FakeRecorder.instances[0]!;
    expect(rec.mimeType).toBe("audio/ogg;codecs=opus");
    expect(rec.startedWith).toBe(250);
  });

  it("maps a denied microphone to a coded VoiceError", async () => {
    const denied = Object.assign(new Error("denied"), {
      name: "NotAllowedError",
    });
    await expect(
      startDictation({
        deps: micDeps({
          getUserMedia: async () => {
            throw denied;
          },
        }),
      }),
    ).rejects.toMatchObject({
      name: "VoiceError",
      code: "VOICE_BACKEND",
      message: expect.stringMatching(/permission was denied/),
    });
  });

  it("maps a missing device to a coded VoiceError", async () => {
    const absent = Object.assign(new Error("nope"), { name: "NotFoundError" });
    await expect(
      startDictation({
        deps: micDeps({
          getUserMedia: async () => {
            throw absent;
          },
        }),
      }),
    ).rejects.toMatchObject({
      code: "VOICE_BACKEND",
      message: expect.stringMatching(/no usable microphone/),
    });
  });

  it("fails honestly when the browser has no capture APIs", async () => {
    await expect(startDictation({ deps: {} })).rejects.toMatchObject({
      code: "VOICE_UNAVAILABLE",
    });
    await expect(
      startDictation({ deps: { getUserMedia: async () => micStream().stream } }),
    ).rejects.toMatchObject({ code: "VOICE_UNAVAILABLE" });
  });

  it("rejects an empty take and a recorder error", async () => {
    FakeRecorder.chunks = [];
    const empty = await startDictation({ deps: micDeps() });
    await expect(empty.stop()).rejects.toMatchObject({
      code: "VOICE_BAD_ARGS",
      message: expect.stringMatching(/no audio was captured/),
    });

    FakeRecorder.chunks = ["hi"];
    FakeRecorder.failOnStop = true;
    const broken = await startDictation({ deps: micDeps() });
    await expect(broken.stop()).rejects.toMatchObject({
      code: "VOICE_BACKEND",
      message: expect.stringMatching(/MediaRecorder error/),
    });
  });

  it("shares one finalize across repeated stop() calls (duration-cap race)", async () => {
    const recorder = await startDictation({ deps: micDeps() });
    const [first, second] = await Promise.all([recorder.stop(), recorder.stop()]);
    expect(first.bytes).toEqual(second.bytes);
    expect(new TextDecoder().decode(first.bytes)).toBe("hello");
  });

  it("cancels without producing audio and releases the mic", async () => {
    const mic = micStream();
    const recorder = await startDictation({
      deps: micDeps({ getUserMedia: async () => mic.stream }),
    });
    recorder.cancel();
    expect(recorder.isRecording()).toBe(false);
    expect(mic.stops).toBe(1);
    await expect(recorder.stop()).rejects.toMatchObject({
      code: "VOICE_BAD_ARGS",
      message: expect.stringMatching(/cancelled/),
    });
  });
});

/* --------------------------------------------------------------- session */

function sessionBroker(result: {
  sessionId: string;
  provider?: string;
  sdpAnswer?: string;
  clientSecret?: string;
  note?: string;
}) {
  return vi.fn(async () => result);
}

describe("startVoiceSession", () => {
  it("negotiates an offer through the Host broker and applies the answer", async () => {
    const mic = micStream();
    const broker = sessionBroker({
      sessionId: "voice_mem_1",
      provider: "memory",
      sdpAnswer: "v=0\r\ns=memory-answer",
      note: "stub",
    });
    const states: string[] = [];

    const handle = await startVoiceSession({
      broker,
      deps: micDeps({ getUserMedia: async () => mic.stream }),
      instructions: "be brief",
      voice: "alloy",
      onStateChange: (s) => states.push(s),
    });

    const pc = FakePeerConnection.instances[0]!;
    expect(pc.added).toHaveLength(1);
    expect(pc.localDescription?.type).toBe("offer");
    expect(pc.remote).toEqual({
      type: "answer",
      sdp: "v=0\r\ns=memory-answer",
    });
    expect(broker).toHaveBeenCalledWith({
      sdpOffer: "v=0\r\ns=test-offer",
      instructions: "be brief",
      voice: "alloy",
    });
    expect(handle.sessionId).toBe("voice_mem_1");
    expect(handle.provider).toBe("memory");
    expect(handle.note).toBe("stub");
    expect(handle.connectionState()).toBe("new");

    pc.connectionState = "connected";
    pc.onconnectionstatechange?.();
    expect(states).toEqual(["connected"]);

    handle.stop();
    expect(pc.closed).toBe(true);
    expect(mic.stops).toBe(1);
    expect(pc.onconnectionstatechange).toBeNull();
  });

  it("refuses a client-secret-only answer and still cleans up", async () => {
    const mic = micStream();
    await expect(
      startVoiceSession({
        broker: sessionBroker({ sessionId: "s1", clientSecret: "sk-temp" }),
        deps: micDeps({ getUserMedia: async () => mic.stream }),
      }),
    ).rejects.toMatchObject({
      code: "VOICE_LIVE_UNSUPPORTED",
      message: expect.stringMatching(/client secret/),
    });
    expect(FakePeerConnection.instances[0]?.closed).toBe(true);
    expect(mic.stops).toBe(1);
  });

  it("rejects an answer with neither SDP nor secret", async () => {
    const mic = micStream();
    await expect(
      startVoiceSession({
        broker: sessionBroker({ sessionId: "s1" }),
        deps: micDeps({ getUserMedia: async () => mic.stream }),
      }),
    ).rejects.toMatchObject({ code: "VOICE_BACKEND" });
    expect(mic.stops).toBe(1);
  });

  it("surfaces a broker failure and releases the mic", async () => {
    const mic = micStream();
    const broker = vi.fn(async () => {
      throw new Error("host down");
    });
    await expect(
      startVoiceSession({
        broker,
        deps: micDeps({ getUserMedia: async () => mic.stream }),
      }),
    ).rejects.toThrow("host down");
    expect(mic.stops).toBe(1);
    expect(FakePeerConnection.instances[0]?.closed).toBe(true);
  });

  it("requires getUserMedia and RTCPeerConnection", async () => {
    await expect(
      startVoiceSession({
        broker: sessionBroker({ sessionId: "s" }),
        deps: {
          getUserMedia: async () => micStream().stream,
        },
      }),
    ).rejects.toMatchObject({ code: "VOICE_UNAVAILABLE" });
  });
});

/* ------------------------------------------------------------- transport */

describe("createBrowserVoiceTransport", () => {
  it("reports capabilities and wires both capture paths", async () => {
    const transport = createBrowserVoiceTransport(
      micDeps({ btoa: (s) => Buffer.from(s, "binary").toString("base64") }),
    );

    expect(transport.capabilities()).toEqual({
      dictation: true,
      session: true,
    });

    const take = await transport.dictate({ maxDurationMs: 0 });
    expect(take.base64).toBe("aGVsbG8=");
    expect(new TextDecoder().decode(take.bytes)).toBe("hello");

    const handle = await transport.session({
      broker: sessionBroker({
        sessionId: "s1",
        sdpAnswer: "v=0\r\nanswer",
      }),
    });
    expect(handle.sessionId).toBe("s1");
    handle.stop();
  });

  it("degrades to no capabilities outside a browser context", () => {
    expect(createBrowserVoiceTransport().capabilities()).toEqual({
      dictation: false,
      session: false,
    });
  });
});

describe("micCapabilities", () => {
  it("needs a mic plus a recorder / peer connection", () => {
    expect(micCapabilities({ getUserMedia: async () => micStream().stream })).toEqual({
      dictation: false,
      session: false,
    });
    expect(micCapabilities(micDeps())).toEqual({
      dictation: true,
      session: true,
    });
    expect(micCapabilities()).toEqual({ dictation: false, session: false });
  });
});
