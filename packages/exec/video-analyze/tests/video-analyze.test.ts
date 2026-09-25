import { describe, expect, it, vi } from "vitest";
import {
  createDefaultVideoAnalyzeAccess,
  createMemoryVideoAnalyzeProvider,
  createVideoAnalyzeTools,
  materializeVideo,
  videoMimeForPath,
  wrapVideoAnalyzePrompt,
} from "../src/index.js";

describe("videoMimeForPath", () => {
  it("maps Hermes extensions", () => {
    expect(videoMimeForPath("a.mp4")).toBe("video/mp4");
    expect(videoMimeForPath("a.MOV")).toBe("video/quicktime");
    expect(videoMimeForPath("a.avi")).toBe("video/mp4");
    expect(videoMimeForPath("a.txt")).toBeUndefined();
  });
});

describe("wrapVideoAnalyzePrompt", () => {
  it("asks for full description then the question", () => {
    const prompt = wrapVideoAnalyzePrompt("Who enters?");
    expect(prompt).toContain("Fully describe");
    expect(prompt).toContain("Who enters?");
  });
});

describe("materializeVideo", () => {
  it("reads a local path via fs", async () => {
    const bytes = new Uint8Array([0, 1, 2, 3]);
    const out = await materializeVideo("clips/demo.mp4", {
      fs: {
        stat: async () => ({ isFile: true }),
        readBytes: async () => bytes,
      },
    });
    expect(out).toMatchObject({
      data: bytes,
      mediaType: "video/mp4",
      source: "path",
    });
  });

  it("downloads http(s) with a size cap", async () => {
    const payload = new Uint8Array([9, 8, 7]);
    const fetchImpl = vi.fn(async () =>
      new Response(payload, {
        status: 200,
        headers: { "content-type": "video/webm" },
      }),
    ) as unknown as typeof fetch;
    const out = await materializeVideo("https://example.com/v.webm", {
      fetchImpl,
    });
    expect(out.mediaType).toBe("video/webm");
    expect(out.source).toBe("url");
    expect([...out.data]).toEqual([9, 8, 7]);
  });

  it("rejects unsupported local extensions", async () => {
    await expect(
      materializeVideo("notes.txt", {
        fs: {
          stat: async () => ({ isFile: true }),
          readBytes: async () => new Uint8Array([1]),
        },
      }),
    ).rejects.toMatchObject({ code: "VIDEO_ANALYZE_UNSUPPORTED" });
  });
});

describe("createVideoAnalyzeTools", () => {
  it("fails honestly when no service is configured", async () => {
    const [tool] = createVideoAnalyzeTools({});
    const result = await tool.execute({
      video_url: "a.mp4",
      question: "what?",
    });
    expect(result.isError).toBe(true);
    expect(String(result.content)).toContain("not enabled");
  });

  it("returns Hermes-shaped JSON on success", async () => {
    const [tool] = createVideoAnalyzeTools({
      service: createMemoryVideoAnalyzeProvider({
        analysis: "a person waves",
      }),
      fs: {
        stat: async () => ({ isFile: true }),
        readBytes: async () => new Uint8Array([1, 2, 3]),
      },
    });
    const result = await tool.execute({
      video_url: "demo.mp4",
      question: "What happens?",
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(String(result.content)) as {
      success: boolean;
      analysis: string;
      provider: string;
    };
    expect(parsed).toMatchObject({
      success: true,
      analysis: "a person waves",
      provider: "memory",
    });
  });
});

describe("createDefaultVideoAnalyzeAccess", () => {
  it("builds memory provider from env bypass", () => {
    const access = createDefaultVideoAnalyzeAccess({
      env: { XRK_VIDEO_ANALYZE: "memory" },
    });
    expect(access.service).toBeDefined();
  });

  it("stays unavailable when Settings mode is off", () => {
    const access = createDefaultVideoAnalyzeAccess({
      env: {},
      product: { mode: "off" },
    });
    expect(access.service).toBeUndefined();
    expect(access.unavailableMessage).toContain("not enabled");
  });
});
