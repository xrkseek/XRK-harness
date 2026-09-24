import { describe, expect, it, vi } from "vitest";
import { createMemoryAttachmentStore } from "@xrkseek/attachment";
import {
  VIDEO_GEN_PROMPT_TEXT,
  VideoGenError,
  createDefaultVideoGenAccess,
  createMemoryVideoGenProvider,
  createOpenAiVideoGenProvider,
  createVideoGenTools,
  isTerminalStatus,
  isVideoGenError,
  minimalMp4Bytes,
  videoGenUnavailableMessage,
} from "../src/index.js";

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
