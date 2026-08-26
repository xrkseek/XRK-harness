import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dropEmbeddedVectorRow,
  syncEmbeddedVectorRow,
} from "../src/dsh-compat/memory-embeddings.js";
import {
  searchEmbeddedVectorStore,
  upsertEmbeddedVectorRow,
} from "../src/dsh-compat/embedded-vector-store.js";
import { handleNoemaRpc, handleNoemaRpcAsync } from "../src/dsh-compat/noema.js";
import {
  embedTextLocal,
  fetchExternalMemorySearch,
  searchMemoryEmbeddings,
  searchMemoryEmbeddingsAsync,
} from "../src/dsh-compat/memory-embeddings.js";
import {
  analyzeWithCloudVisionRoute,
  analyzeWithCloudVisionRouteAsync,
  resolveCloudVisionRoute,
} from "../src/dsh-compat/cloud-vision-routing.js";
import {
  inferCloudVisionFromImages,
  OPENAI_COMPAT_VISION_BASE,
} from "../src/dsh-compat/cloud-vision-inference.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function seedVisionSettings(
  home: string,
  user: Record<string, unknown>,
): void {
  mkdirSync(path.join(home, "settings-docs"), { recursive: true });
  writeFileSync(
    path.join(home, "settings-docs", "vision-router.json"),
    JSON.stringify({ user, revision: 1 }),
  );
}

describe("cloud-vision-routing", () => {
  it("defaults to local bridge without settings", () => {
    const route = resolveCloudVisionRoute({});
    expect(route.mode).toBe("xrk-bridge");
    expect(route.routed).toBe(false);
  });

  it("routes when provider model and apiKeyEnv are configured", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-vision-route-"));
    temps.push(home);
    seedVisionSettings(home, {
      enabled: true,
      provider: "deepseek",
      model: "deepseek-v4-flash-vision-exp",
    });
    const route = resolveCloudVisionRoute({
      xrkHome: home,
      env: { DEEPSEEK_API_KEY: "test-key" },
    });
    expect(route.mode).toBe("cloud-routed");
    expect(route.routed).toBe(true);
    expect(route.apiKeyEnv).toBe("DEEPSEEK_API_KEY");
  });

  it("tags incomplete when enabled but api key missing", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-vision-missing-"));
    temps.push(home);
    seedVisionSettings(home, {
      enabled: true,
      provider: "openai",
      model: "gpt-4o",
    });
    const out = analyzeWithCloudVisionRoute('{"text":"hello"}', {
      xrkHome: home,
      env: {},
    });
    expect(out.mode).toBe("xrk-bridge");
    expect(out.incomplete).toContain("cloud-vision-routing");
  });

  it("calls OpenAI-compatible vision when routed and images present", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-vision-infer-"));
    temps.push(home);
    seedVisionSettings(home, {
      enabled: true,
      provider: "deepseek",
      model: "deepseek-v4-flash-vision-exp",
    });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: "cloud ocr text" } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const out = await analyzeWithCloudVisionRouteAsync(
        JSON.stringify({ images: [`data:image/png;base64,${png.toString("base64")}`] }),
        { xrkHome: home, env: { DEEPSEEK_API_KEY: "test-key" } },
      );
      expect(out.cloudInference).toEqual({
        inferred: true,
        provider: "deepseek",
        model: "deepseek-v4-flash-vision-exp",
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        `${OPENAI_COMPAT_VISION_BASE.deepseek}/chat/completions`,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("marks unknown provider without vision inference", async () => {
    const route = {
      mode: "cloud-routed" as const,
      configured: true,
      routed: true,
      provider: "unknown-vendor",
      model: "vision-x",
      apiKeyEnv: "UNKNOWN_KEY",
    };
    const out = await inferCloudVisionFromImages([Buffer.from("abc")], route, {
      UNKNOWN_KEY: "k",
    });
    expect(out.inferred).toBe(false);
    expect(out.incomplete).toContain("cloud-vision-inference");
  });

  it("calls anthropic messages when provider is anthropic", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        content: [{ type: "text", text: "anthropic ocr" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const out = await inferCloudVisionFromImages(
        [Buffer.from("abc")],
        {
          mode: "cloud-routed",
          configured: true,
          routed: true,
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          apiKeyEnv: "ANTHROPIC_API_KEY",
        },
        { ANTHROPIC_API_KEY: "test-key" },
      );
      expect(out.inferred).toBe(true);
      expect(out.texts[0]).toBe("anthropic ocr");
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/messages");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("calls gemini generateContent when provider is gemini", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        candidates: [{ content: { parts: [{ text: "gemini ocr" }] } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const out = await inferCloudVisionFromImages(
        [Buffer.from("abc")],
        {
          mode: "cloud-routed",
          configured: true,
          routed: true,
          provider: "gemini",
          model: "gemini-2.0-flash",
          apiKeyEnv: "GEMINI_API_KEY",
        },
        { GEMINI_API_KEY: "test-key" },
      );
      expect(out.inferred).toBe(true);
      expect(out.texts[0]).toBe("gemini ocr");
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain("generateContent");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("memory-embeddings bridge", () => {
  it("returns stable local vectors", () => {
    const a = embedTextLocal("hello world");
    const b = embedTextLocal("hello world");
    expect(a).toEqual(b);
    expect(a.length).toBe(32);
  });

  it("embedded vector store persists and searches", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-embed-store-"));
    temps.push(home);
    upsertEmbeddedVectorRow(home, {
      id: "m1",
      text: "needle about circuits",
      tags: ["hw"],
    });
    const hits = searchEmbeddedVectorStore(home, "circuits");
    expect(hits[0]?.id).toBe("m1");
    syncEmbeddedVectorRow(home, { id: "m2", text: "beta alpha" });
    dropEmbeddedVectorRow(home, "m2");
  });

  it("embedding.search via noema uses embedded host after add", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-noema-embed-"));
    temps.push(home);
    handleNoemaRpc(
      "memory.add",
      { text: "needle memory about circuits" },
      { xrkHome: home },
    );
    const out = (await handleNoemaRpcAsync(
      "embedding.search",
      { query: "circuits" },
      { xrkHome: home },
    )) as { ok?: boolean; hits?: unknown[]; mode?: string };
    expect(out.ok).toBe(true);
    expect(out.mode).toBe("embedded-host");
    expect((out.hits ?? []).length).toBeGreaterThan(0);

    const ranked = searchMemoryEmbeddings(
      [{ id: "1", text: "alpha beta" }, { id: "2", text: "gamma delta" }],
      "beta",
    );
    expect(ranked[0]?.id).toBe("1");
  });

  it("searchMemoryEmbeddingsAsync uses sidecar when configured", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        hits: [{ id: "s1", text: "sidecar hit", score: 0.99 }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { hits, mode } = await searchMemoryEmbeddingsAsync(
        [],
        "needle",
        8,
        { XRK_MEMORY_EMBED_URL: "http://127.0.0.1:6333" },
      );
      expect(mode).toBe("sidecar");
      expect(hits[0]?.id).toBe("s1");
      expect(fetchMock).toHaveBeenCalledOnce();
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(body.query).toBe("needle");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fetchExternalMemorySearch returns null on upstream error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 })),
    );
    try {
      const hits = await fetchExternalMemorySearch(
        { url: "http://127.0.0.1:6333" },
        "q",
      );
      expect(hits).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
