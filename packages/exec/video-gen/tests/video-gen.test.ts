import { describe, expect, it, vi } from "vitest";
import { createMemoryAttachmentStore } from "@xrkseek/attachment";
import {
  VIDEO_GEN_CAPABILITIES_TEXT_ONLY,
  VIDEO_GEN_PROMPT_TEXT,
  VideoGenError,
  buildVideoGenToolParameters,
  createDefaultVideoGenAccess,
  createMemoryVideoGenProvider,
  createOpenAiVideoGenProvider,
  createVideoGenTools,
  formatVideoGenCatalog,
  isTerminalStatus,
  isVideoGenError,
  minimalMp4Bytes,
  OPENAI_VIDEO_GEN_FAMILIES,
  resolveVideoGenCapabilities,
  resolveVideoGenReferenceImages,
  videoGenSupportsI2v,
  videoGenUnavailableMessage,
} from "../src/index.js";

function tinyPng(): Uint8Array {
  // Minimal 1×1 PNG
  return Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
}

/** Faux test service that is always already completed. */
function completedService() {
  const bytes = minimalMp4Bytes();
  return {
    async create(req: { prompt: string }) {
      return {
        jobId: "job-1",
        status: "queued" as const,
        model: "sora-2",
        provider: "fake",
        delivery: "memory" as const,
        note: `queued:${req.prompt}`,
      };
    },
    async get() {
      return {
        jobId: "job-1",
        status: "completed" as const,
        progress: 100,
        provider: "fake",
        delivery: "memory" as const,
      };
    },
    async content() {
      return {
        bytes,
        mimeType: "video/mp4" as const,
        provider: "fake",
      };
    },
  };
}

describe("exec-video-gen types", () => {
  it("marks terminal statuses", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("queued")).toBe(false);
    expect(isTerminalStatus("in_progress")).toBe(false);
  });

  it("errors carry a code and are detectable", () => {
    const err = new VideoGenError("nope", "VIDEO_GEN_NOT_READY");
    expect(isVideoGenError(err)).toBe(true);
    expect(isVideoGenError(new Error("x"))).toBe(false);
    expect(err.code).toBe("VIDEO_GEN_NOT_READY");
    expect(err.name).toBe("VideoGenError");
  });

  it("minimal mp4 is a well-formed ftyp box", () => {
    const bytes = minimalMp4Bytes();
    expect(bytes.byteLength).toBe(24);
    expect(new DataView(bytes.buffer).getUint32(0)).toBe(24);
    expect(String.fromCharCode(...bytes.slice(4, 8))).toBe("ftyp");
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe("isom");
  });
});

describe("memory provider", () => {
  it("runs the queued → in_progress → completed lifecycle", async () => {
    const svc = createMemoryVideoGenProvider();
    const job = await svc.create({ prompt: "a drifting nebula", seconds: 8 });
    expect(job.provider).toBe("memory");
    expect(job.status).toBe("queued");
    expect(job.jobId).toMatch(/^video_mem_/);

    const second = await svc.get(job.jobId);
    expect(second.status).toBe("in_progress");
    expect(second.progress).toBe(66);

    const third = await svc.get(job.jobId);
    expect(third.status).toBe("completed");
    expect(third.progress).toBe(100);

    // Once terminal, further polls stay terminal.
    const fourth = await svc.get(job.jobId);
    expect(fourth.status).toBe("completed");
  });

  it("rejects an empty prompt", async () => {
    const svc = createMemoryVideoGenProvider();
    await expect(svc.create({ prompt: "   " })).rejects.toMatchObject({
      code: "VIDEO_GEN_BAD_ARGS",
    });
  });

  it("content is refused until the job completes", async () => {
    const svc = createMemoryVideoGenProvider();
    const { jobId } = await svc.create({ prompt: "x" });
    await expect(svc.content(jobId)).rejects.toMatchObject({
      code: "VIDEO_GEN_NOT_READY",
    });
  });

  it("content returns mp4 bytes once completed", async () => {
    const svc = createMemoryVideoGenProvider();
    const { jobId } = await svc.create({ prompt: "x" });
    for (let i = 0; i < 3; i += 1) await svc.get(jobId);
    const media = await svc.content(jobId);
    expect(media.mimeType).toBe("video/mp4");
    expect(media.bytes).toEqual(minimalMp4Bytes());
  });

  it("unknown job ids are rejected", async () => {
    const svc = createMemoryVideoGenProvider();
    await expect(svc.get("nope")).rejects.toMatchObject({
      code: "VIDEO_GEN_BAD_ARGS",
    });
  });

  it("failAfter drives the terminal-failure path", async () => {
    const svc = createMemoryVideoGenProvider({ failAfter: 1 });
    const { jobId } = await svc.create({ prompt: "x" });
    const job = await svc.get(jobId);
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/simulated render failure/);
    await expect(svc.content(jobId)).rejects.toMatchObject({
      code: "VIDEO_GEN_NOT_READY",
    });
  });
});

describe("video_generate tool", () => {
  it("fails honestly without a Provider", async () => {
    const [tool] = createVideoGenTools({ env: {} });
    const out = await tool!.execute({ prompt: "hi" });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/XRK_VIDEO_GEN/);
  });

  it("start returns a job id and next step", async () => {
    const [tool] = createVideoGenTools({
      service: createMemoryVideoGenProvider(),
      env: { XRK_VIDEO_GEN: "memory" },
    });
    const out = await tool!.execute({ action: "start", prompt: "ocean" });
    expect(out.isError).toBeFalsy();
    expect(out.content).toMatch(/status=queued/);
    expect(out.content).toMatch(/Next: action=status/);
  });

  it("status reports the polled state", async () => {
    const [tool] = createVideoGenTools({
      service: createMemoryVideoGenProvider(),
      env: { XRK_VIDEO_GEN: "memory" },
    });
    const started = await tool!.execute({ prompt: "ocean" });
    const jobId = /jobId=(\S+)/.exec(started.content)![1]!;
    const out = await tool!.execute({ action: "status", job_id: jobId });
    expect(out.isError).toBeFalsy();
    expect(out.content).toMatch(/status=in_progress/);
  });

  it("status marks a failed job as an error", async () => {
    const [tool] = createVideoGenTools({
      service: createMemoryVideoGenProvider({ failAfter: 1 }),
      env: { XRK_VIDEO_GEN: "memory" },
    });
    const started = await tool!.execute({ prompt: "ocean" });
    const jobId = /jobId=(\S+)/.exec(started.content)![1]!;
    const out = await tool!.execute({ action: "status", job_id: jobId });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/status=failed/);
  });

  it("wait polls with injected clock/sleep until completion", async () => {
    const sleep = vi.fn(async () => {});
    let clock = 0;
    const [tool] = createVideoGenTools({
      service: createMemoryVideoGenProvider(),
      env: { XRK_VIDEO_GEN: "memory" },
      sleep,
      now: () => (clock += 1),
    });
    const started = await tool!.execute({ prompt: "ocean" });
    const jobId = /jobId=(\S+)/.exec(started.content)![1]!;
    const out = await tool!.execute({
      action: "wait",
      job_id: jobId,
      timeout_ms: 5_000,
      poll_interval_ms: 1,
    });
    expect(out.isError).toBeFalsy();
    expect(out.content).toMatch(/status=completed/);
    expect(sleep).toHaveBeenCalled();
  });

  it("wait reports timeout=true without erroring on a slow job", async () => {
    let clock = 0;
    const slow = {
      async create() {
        return {
          jobId: "j",
          status: "queued" as const,
          provider: "fake",
          delivery: "memory" as const,
        };
      },
      async get() {
        return {
          jobId: "j",
          status: "in_progress" as const,
          provider: "fake",
          delivery: "memory" as const,
        };
      },
      async content() {
        throw new Error("unreachable");
      },
    };
    const [tool] = createVideoGenTools({
      service: slow,
      env: { XRK_VIDEO_GEN: "memory" },
      sleep: async () => {},
      now: () => (clock += 1_000),
    });
    const out = await tool!.execute({
      action: "wait",
      job_id: "j",
      timeout_ms: 2_000,
      poll_interval_ms: 1,
    });
    expect(out.isError).toBeFalsy();
    expect(out.content).toMatch(/timeout=true/);
  });

  it("content persists the mp4 through the attachment store", async () => {
    const attachments = createMemoryAttachmentStore();
    const [tool] = createVideoGenTools({
      service: completedService(),
      env: { XRK_VIDEO_GEN: "memory" },
      attachments,
    });
    const out = await tool!.execute({ action: "content", job_id: "job-1" });
    expect(out.isError).toBeFalsy();
    expect(out.content).toMatch(/mime=video\/mp4/);
    expect(out.content).toMatch(/attachmentId=/);
    expect(out.content).toMatch(/file=video_generate_job-1\.mp4/);
  });

  it("content explains itself without an attachment store", async () => {
    const [tool] = createVideoGenTools({
      service: completedService(),
      env: { XRK_VIDEO_GEN: "memory" },
    });
    const out = await tool!.execute({ action: "content", job_id: "job-1" });
    expect(out.isError).toBeFalsy();
    expect(out.content).toMatch(/no AttachmentStore is wired/);
  });

  it("content reports not_ready for an unfinished job", async () => {
    const [tool] = createVideoGenTools({
      service: createMemoryVideoGenProvider(),
      env: { XRK_VIDEO_GEN: "memory" },
    });
    const started = await tool!.execute({ prompt: "ocean" });
    const jobId = /jobId=(\S+)/.exec(started.content)![1]!;
    const out = await tool!.execute({ action: "content", job_id: jobId });
    expect(out.isError).toBeFalsy();
    expect(out.content).toMatch(/not_ready=true/);
  });

  it("validates action, size, seconds and job_id", async () => {
    const [tool] = createVideoGenTools({
      service: createMemoryVideoGenProvider(),
      env: { XRK_VIDEO_GEN: "memory" },
    });
    const badAction = await tool!.execute({ action: "render" });
    expect(badAction.isError).toBe(true);
    expect(badAction.content).toMatch(/action must be one of/);

    const badSize = await tool!.execute({ prompt: "x", size: "1x1" });
    expect(badSize.isError).toBe(true);
    expect(badSize.content).toMatch(/size must be one of/);

    const badSeconds = await tool!.execute({ prompt: "x", seconds: 5 });
    expect(badSeconds.isError).toBe(true);
    expect(badSeconds.content).toMatch(/seconds must be one of/);

    const missingPrompt = await tool!.execute({ action: "start" });
    expect(missingPrompt.isError).toBe(true);
    expect(missingPrompt.content).toMatch(/prompt is required/);

    const missingJob = await tool!.execute({ action: "status" });
    expect(missingJob.isError).toBe(true);
    expect(missingJob.content).toMatch(/job_id is required/);
  });

  it("exposes a model-facing prompt block", () => {
    expect(VIDEO_GEN_PROMPT_TEXT).toMatch(/video_generate/);
    expect(VIDEO_GEN_PROMPT_TEXT).toMatch(/asynchronous/i);
  });
});

describe("OpenAI provider", () => {
  it("posts a multipart create and parses the job", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const svc = createOpenAiVideoGenProvider({
      apiKey: "sk-test",
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), init: init ?? {} });
        return Response.json({
          id: "video_abc",
          status: "queued",
          progress: 0,
          model: "sora-2",
          seconds: "4",
          size: "1280x720",
        });
      },
    });
    const job = await svc.create({ prompt: "a kite", seconds: 4 });
    expect(job.jobId).toBe("video_abc");
    expect(job.status).toBe("queued");
    expect(job.provider).toBe("openai");
    expect(calls[0]!.url).toMatch(/\/videos$/);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers).toMatchObject({
      Authorization: "Bearer sk-test",
    });
  });

  it("maps provider status strings and error text", async () => {
    const svc = createOpenAiVideoGenProvider({
      apiKey: "k",
      baseUrl: "https://example.test/v1/",
      fetchImpl: async () =>
        Response.json({
          id: "video_1",
          status: "failed",
          error: { message: "policy violation" },
        }),
    });
    const job = await svc.get("video_1");
    expect(job.status).toBe("failed");
    expect(job.error).toBe("policy violation");
  });

  it("rejects an unknown status and a missing id", async () => {
    const unknown = createOpenAiVideoGenProvider({
      apiKey: "k",
      fetchImpl: async () => Response.json({ id: "v", status: "banana" }),
    });
    await expect(unknown.get("v")).rejects.toMatchObject({
      code: "VIDEO_GEN_BACKEND",
    });

    const noId = createOpenAiVideoGenProvider({
      apiKey: "k",
      fetchImpl: async () => Response.json({ status: "queued" }),
    });
    await expect(noId.get("v")).rejects.toMatchObject({
      code: "VIDEO_GEN_BACKEND",
    });
  });

  it("surfaces HTTP failures honestly", async () => {
    const svc = createOpenAiVideoGenProvider({
      apiKey: "k",
      fetchImpl: async () => new Response("bad key", { status: 401 }),
    });
    await expect(svc.create({ prompt: "x" })).rejects.toMatchObject({
      code: "VIDEO_GEN_BACKEND",
    });
  });

  it("content checks readiness then downloads the mp4", async () => {
    const svc = createOpenAiVideoGenProvider({
      apiKey: "k",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/content")) {
          return new Response(minimalMp4Bytes(), { status: 200 });
        }
        return Response.json({ id: "video_1", status: "completed" });
      },
    });
    const media = await svc.content("video_1");
    expect(media.mimeType).toBe("video/mp4");
    expect(media.bytes).toEqual(minimalMp4Bytes());
  });

  it("content refuses an unfinished job before downloading", async () => {
    const svc = createOpenAiVideoGenProvider({
      apiKey: "k",
      fetchImpl: async () => Response.json({ id: "v", status: "in_progress" }),
    });
    await expect(svc.content("v")).rejects.toMatchObject({
      code: "VIDEO_GEN_NOT_READY",
    });
  });

  it("requires a job id for get/content", async () => {
    const svc = createOpenAiVideoGenProvider({ apiKey: "k" });
    await expect(svc.get("  ")).rejects.toMatchObject({
      code: "VIDEO_GEN_BAD_ARGS",
    });
    await expect(svc.content("")).rejects.toMatchObject({
      code: "VIDEO_GEN_BAD_ARGS",
    });
  });
});

describe("default access + messages", () => {
  it("honours injected service, memory, api key and disabled states", () => {
    const injected = completedService();
    expect(createDefaultVideoGenAccess({ env: {}, service: injected }).service).toBe(
      injected,
    );
    expect(
      createDefaultVideoGenAccess({ env: { XRK_VIDEO_GEN: "memory" } }).service,
    ).toBeTruthy();
    expect(createDefaultVideoGenAccess({ env: {} }).service).toBeUndefined();
    expect(
      createDefaultVideoGenAccess({ env: { XRK_VIDEO_GEN: "1" } }).service,
    ).toBeUndefined();
    expect(
      createDefaultVideoGenAccess({
        env: { XRK_VIDEO_GEN: "1", XRK_VIDEO_GEN_OPENAI_KEY: "sk" },
      }).service,
    ).toBeTruthy();
    expect(
      createDefaultVideoGenAccess({
        env: { XRK_VIDEO_GEN: "1", OPENAI_API_KEY: "sk" },
      }).service,
    ).toBeTruthy();
    expect(
      createDefaultVideoGenAccess({
        env: { XRK_VIDEO_GEN_OPENAI_KEY: "sk" },
        product: { mode: "openai" },
      }).service,
    ).toBeTruthy();
    expect(
      createDefaultVideoGenAccess({
        env: {},
        product: { mode: "off" },
      }).service,
    ).toBeUndefined();
  });

  it("forwards base url / model / fetch into the OpenAI provider", async () => {
    let seenUrl = "";
    const access = createDefaultVideoGenAccess({
      env: {
        XRK_VIDEO_GEN: "1",
        XRK_VIDEO_GEN_OPENAI_KEY: "sk",
        XRK_VIDEO_GEN_BASE_URL: "https://proxy.test/v1",
      },
      fetchImpl: async (input) => {
        seenUrl = String(input);
        return Response.json({ id: "v", status: "queued" });
      },
    });
    await access.service!.create({ prompt: "x" });
    expect(seenUrl).toBe("https://proxy.test/v1/videos");
  });

  it("explains each disabled state", () => {
    expect(videoGenUnavailableMessage({})).toMatch(/not enabled/);
    expect(videoGenUnavailableMessage({ XRK_VIDEO_GEN: "1" })).toMatch(/no API key/);
    expect(videoGenUnavailableMessage({ XRK_VIDEO_GEN: "other" })).toMatch(
      /no VideoGenService Provider/,
    );
  });
});

describe("i2v / capabilities / catalog / edit-extend", () => {
  it("memory i2v records modality=image", async () => {
    const svc = createMemoryVideoGenProvider();
    expect(videoGenSupportsI2v(svc.capabilities!())).toBe(true);
    const job = await svc.create({
      prompt: "animate gently",
      firstFrame: { bytes: tinyPng(), mimeType: "image/png", label: "still" },
    });
    expect(job.modality).toBe("image");
    expect(job.kind).toBe("generate");
    expect(job.note).toMatch(/image/);
  });

  it("dynamic schema omits i2v/edit for text-only Provider", () => {
    const textOnly = createMemoryVideoGenProvider({
      capabilities: VIDEO_GEN_CAPABILITIES_TEXT_ONLY,
    });
    const [tool] = createVideoGenTools({ service: textOnly });
    const props = tool!.parameters.properties as Record<string, unknown>;
    expect(props.first_frame).toBeUndefined();
    expect(props.image_url).toBeUndefined();
    const action = props.action as { enum: string[] };
    expect(action.enum).not.toContain("edit");
    expect(action.enum).not.toContain("extend");
    expect(action.enum).toContain("catalog");
    expect(tool!.description).toMatch(/text-to-video only/);
  });

  it("dynamic schema includes i2v + edit + extend when caps allow", () => {
    const [tool] = createVideoGenTools({
      service: createMemoryVideoGenProvider(),
    });
    const props = tool!.parameters.properties as Record<string, unknown>;
    expect(props.first_frame).toBeTruthy();
    expect(props.image_url).toBeTruthy();
    expect(props.reference_attachment_ids).toBeTruthy();
    const action = props.action as { enum: string[] };
    expect(action.enum).toEqual(
      expect.arrayContaining(["start", "edit", "extend", "catalog"]),
    );
    expect(buildVideoGenToolParameters(resolveVideoGenCapabilities(undefined)).properties
      .first_frame).toBeUndefined();
  });

  it("tools start i2v via first_frame data URL", async () => {
    const pngB64 = Buffer.from(tinyPng()).toString("base64");
    const [tool] = createVideoGenTools({
      service: createMemoryVideoGenProvider(),
      env: { XRK_VIDEO_GEN: "memory" },
    });
    const out = await tool!.execute({
      action: "start",
      prompt: "pan right",
      first_frame: `data:image/png;base64,${pngB64}`,
    });
    expect(out.isError).toBeFalsy();
    expect(out.content).toMatch(/modality=image/);
    expect(out.content).toMatch(/kind=generate/);
  });

  it("tools start i2v via reference_attachment_ids", async () => {
    const attachments = createMemoryAttachmentStore();
    const saved = await attachments.saveImage({
      data: tinyPng(),
      mediaType: "image/png",
      name: "frame.png",
    });
    const [tool] = createVideoGenTools({
      service: createMemoryVideoGenProvider(),
      env: { XRK_VIDEO_GEN: "memory" },
      attachments,
    });
    const out = await tool!.execute({
      prompt: "zoom in",
      reference_attachment_ids: [saved.attachmentId],
    });
    expect(out.isError).toBeFalsy();
    expect(out.content).toMatch(/modality=image/);
  });

  it("tools reject i2v args on text-only Provider", async () => {
    const [tool] = createVideoGenTools({
      service: createMemoryVideoGenProvider({
        capabilities: VIDEO_GEN_CAPABILITIES_TEXT_ONLY,
      }),
      env: { XRK_VIDEO_GEN: "memory" },
    });
    const out = await tool!.execute({
      prompt: "x",
      image_url: "https://example.com/a.png",
    });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/does not support first-frame/);
  });

  it("action=catalog lists OpenAI-shaped families", async () => {
    const [tool] = createVideoGenTools({
      service: createMemoryVideoGenProvider(),
      env: { XRK_VIDEO_GEN: "memory" },
    });
    const out = await tool!.execute({ action: "catalog" });
    expect(out.isError).toBeFalsy();
    expect(out.content).toMatch(/id=sora-2/);
    expect(formatVideoGenCatalog(OPENAI_VIDEO_GEN_FAMILIES)).toMatch(/sora-2-pro/);
  });

  it("action=edit and action=extend chain from a prior job", async () => {
    const svc = createMemoryVideoGenProvider();
    const [tool] = createVideoGenTools({
      service: svc,
      env: { XRK_VIDEO_GEN: "memory" },
    });
    const started = await tool!.execute({ prompt: "base clip" });
    const jobId = /jobId=(\S+)/.exec(started.content)![1]!;

    const edited = await tool!.execute({
      action: "edit",
      job_id: jobId,
      prompt: "shift palette to teal",
    });
    expect(edited.isError).toBeFalsy();
    expect(edited.content).toMatch(/kind=edit/);

    const extended = await tool!.execute({
      action: "extend",
      job_id: jobId,
      prompt: "continue rising over rooftops",
      seconds: 8,
    });
    expect(extended.isError).toBeFalsy();
    expect(extended.content).toMatch(/kind=extend/);
  });

  it("OpenAI provider posts input_reference for i2v and JSON for edit/extend", async () => {
    const calls: { url: string; method?: string; formKeys?: string[] }[] = [];
    const svc = createOpenAiVideoGenProvider({
      apiKey: "sk-test",
      fetchImpl: async (input, init) => {
        const url = String(input);
        const method = init?.method;
        let formKeys: string[] | undefined;
        if (init?.body instanceof FormData) {
          formKeys = [...init.body.keys()];
        }
        calls.push({ url, method, formKeys });
        return Response.json({
          id: "video_new",
          status: "queued",
          progress: 0,
          model: "sora-2",
        });
      },
    });

    await svc.create({
      prompt: "animate",
      firstFrame: { bytes: tinyPng(), mimeType: "image/png" },
    });
    expect(calls[0]!.url).toMatch(/\/videos$/);
    expect(calls[0]!.formKeys).toContain("input_reference");

    await svc.create({
      prompt: "teal palette",
      kind: "edit",
      sourceVideoId: "video_abc",
    });
    expect(calls[1]!.url).toMatch(/\/videos\/edits$/);

    await svc.create({
      prompt: "continue",
      kind: "extend",
      sourceVideoId: "video_abc",
      seconds: 8,
    });
    expect(calls[2]!.url).toMatch(/\/videos\/extensions$/);
  });

  it("resolves data: and attachment: reference URLs", async () => {
    const attachments = createMemoryAttachmentStore();
    const saved = await attachments.saveImage({
      data: tinyPng(),
      mediaType: "image/png",
      name: "a.png",
    });
    const pngB64 = Buffer.from(tinyPng()).toString("base64");
    const stills = await resolveVideoGenReferenceImages({
      firstFrame: `data:image/png;base64,${pngB64}`,
      referenceImageUrls: [`attachment:${saved.attachmentId}`],
      attachments,
      maxReferenceImages: 2,
    });
    // maxReferenceImages=2 but OpenAI path uses 1; resolver fills up to max
    expect(stills.length).toBeGreaterThanOrEqual(1);
    expect(stills[0]!.mimeType).toBe("image/png");
  });

  it("prompt text mentions i2v and catalog", () => {
    expect(VIDEO_GEN_PROMPT_TEXT).toMatch(/first_frame|image_url/);
    expect(VIDEO_GEN_PROMPT_TEXT).toMatch(/catalog|edit|extend/i);
  });
});
