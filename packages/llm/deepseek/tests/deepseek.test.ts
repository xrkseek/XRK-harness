import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_CATALOG,
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_VISION_EXP_MODEL,
  createDeepSeekAdapter,
  DeepSeekFileStore,
  isDeepSeekVisionModel,
  isOfficialDeepSeekBaseUrl,
  resolveDeepSeekInputModalities,
} from "../src/index.js";
import { DeepSeekUploadIndex } from "../src/upload-index.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("deepseek adapter", () => {
  it("detects official baseUrl", () => {
    expect(isOfficialDeepSeekBaseUrl(DEEPSEEK_DEFAULT_BASE_URL)).toBe(true);
    expect(isOfficialDeepSeekBaseUrl("https://gateway.example/v1")).toBe(false);
  });

  it("defaults baseUrl and model; bearer auth", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(`${DEEPSEEK_DEFAULT_BASE_URL}/chat/completions`);
      const body = JSON.parse(String(init?.body)) as { model: string };
      expect(body.model).toBe(DEEPSEEK_DEFAULT_MODEL);
      expect(init?.headers).toMatchObject({
        authorization: "Bearer sk-ds",
      });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok", tool_calls: [] } }],
        }),
        { status: 200 },
      );
    });

    const llm = createDeepSeekAdapter({
      apiKey: "sk-ds",
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(llm.id).toBe("deepseek");
    expect(llm.inputModalities).toEqual(["text"]);
    expect(llm.stream).toBeTypeOf("function");

    const out = await llm.chat({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.content).toBe("ok");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("allows baseUrl and model override", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://gateway.example/v1/chat/completions");
      const body = JSON.parse(String(init?.body)) as { model: string };
      expect(body.model).toBe("deepseek-v4-flash");
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "gw" } }],
        }),
        { status: 200 },
      );
    });

    const llm = createDeepSeekAdapter({
      id: "ds-gw",
      baseUrl: "https://gateway.example/v1",
      model: "deepseek-v4-flash",
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(llm.id).toBe("ds-gw");
    expect(llm.inputModalities).toEqual(["text", "image"]);
    const out = await llm.chat({
      messages: [{ role: "user", content: "x" }],
    });
    expect(out.content).toBe("gw");
  });

  it("declares image on official host for vision-exp catalog model", () => {
    expect(isDeepSeekVisionModel(DEEPSEEK_VISION_EXP_MODEL)).toBe(true);
    expect(
      resolveDeepSeekInputModalities({
        baseUrl: DEEPSEEK_DEFAULT_BASE_URL,
        model: DEEPSEEK_VISION_EXP_MODEL,
      }),
    ).toEqual(["text", "image"]);
    const llm = createDeepSeekAdapter({
      apiKey: "sk",
      model: DEEPSEEK_VISION_EXP_MODEL,
    });
    expect(llm.inputModalities).toEqual(["text", "image"]);
    expect(DEEPSEEK_DEFAULT_CATALOG.map((m) => m.id)).toContain(
      DEEPSEEK_VISION_EXP_MODEL,
    );
  });

  it("emits thinking wire when reasoningEffort is set", async () => {
    let body: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        }),
        { status: 200 },
      );
    });
    const llm = createDeepSeekAdapter({
      apiKey: "sk",
      fetch: fetchMock as unknown as typeof fetch,
      enableStream: false,
    });
    await llm.chat({
      messages: [{ role: "user", content: "hi" }],
      reasoningEffort: "max",
    });
    expect(body?.thinking).toEqual({ type: "enabled" });
    expect(body?.reasoning_effort).toBe("max");
  });

  it("prefers Files API wire on official vision-exp host", async () => {
    const indexDir = mkdtempSync(path.join(tmpdir(), "xrk-ds-files-"));
    temps.push(indexDir);
    const indexPath = path.join(indexDir, "files-v3.json");

    let body: { messages?: { content?: unknown[] }[] } | undefined;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/files")) {
        return new Response(
          JSON.stringify({
            id: "file-abc",
            object: "file",
            bytes: 4,
            created_at: 1,
            filename: "xrk-test.png",
            purpose: "user_data",
            expires_at: 9_999_999,
          }),
          { status: 200 },
        );
      }
      body = JSON.parse(String(init?.body)) as typeof body;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "seen" } }],
        }),
        { status: 200 },
      );
    });

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const llm = createDeepSeekAdapter({
      apiKey: "sk-ds",
      model: DEEPSEEK_VISION_EXP_MODEL,
      fetch: fetchMock as unknown as typeof fetch,
      enableStream: false,
      fileStore: new DeepSeekFileStore({
        index: new DeepSeekUploadIndex(indexPath),
        fetch: fetchMock as unknown as typeof fetch,
      }),
    });

    await llm.chat({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              attachment: {
                attachmentId: "sha256:abc",
                mediaType: "image/png",
                bytes: png.byteLength,
                width: 1,
                height: 1,
              },
            },
          ],
        },
      ],
      resolveImage: async () => ({
        mediaType: "image/png",
        data: png,
        ref: {
          attachmentId: "sha256:abc",
          mediaType: "image/png",
          bytes: png.byteLength,
          width: 1,
          height: 1,
        },
      }),
    });

    const user = body?.messages?.[0];
    const parts = Array.isArray(user?.content) ? user.content : [];
    expect(parts.some((p) => (p as { type?: string }).type === "file")).toBe(
      true,
    );
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).endsWith("/files")),
    ).toBe(true);
  });
});
