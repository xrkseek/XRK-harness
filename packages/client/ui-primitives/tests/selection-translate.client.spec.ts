// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  SELECTION_TRANSLATE_AUTO_CHAIN,
  translateSelectionText,
} from "../src/selection-translate.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("translateSelectionText", () => {
  it("rejects empty and oversized text", async () => {
    expect(await translateSelectionText("   ")).toEqual({
      ok: false,
      error: "empty selection",
    });
    const huge = "a".repeat(4001);
    const out = await translateSelectionText(huge);
    expect(out.ok).toBe(false);
  });

  it("defaults to Bing first in the auto chain docs", () => {
    expect(SELECTION_TRANSLATE_AUTO_CHAIN[0]).toBe("bing");
    expect(SELECTION_TRANSLATE_AUTO_CHAIN).toEqual([
      "bing",
      "youdao",
      "mymemory",
      "google",
    ]);
  });

  it("posts to Bing Edge and returns translated text", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([{ translations: [{ text: "你好" }] }]),
    );
    const out = await translateSelectionText("hello", {
      target: "zh-Hans",
      provider: "bing",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toEqual({
      ok: true,
      text: "你好",
      target: "zh-Hans",
      provider: "bing",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("edge.microsoft.com/translate");
    expect(String(url)).toContain("to=zh-Hans");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("omit");
    expect(init?.redirect).toBe("error");
  });

  it("posts Youdao aidemo form when provider=youdao", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ errorCode: "0", translation: ["你好"] }),
    );
    const out = await translateSelectionText("hello", {
      target: "zh-Hans",
      provider: "youdao",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toEqual({
      ok: true,
      text: "你好",
      target: "zh-Hans",
      provider: "youdao",
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("aidemo.youdao.com/trans");
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toContain("q=hello");
    expect(String(init?.body)).toContain("from=Auto");
    expect(String(init?.body)).toContain("to=zh-CHS");
  });

  it("gets MyMemory when provider=mymemory", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        responseStatus: 200,
        responseData: { translatedText: "你好" },
      }),
    );
    const out = await translateSelectionText("hello", {
      target: "zh-Hans",
      provider: "mymemory",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toEqual({
      ok: true,
      text: "你好",
      target: "zh-Hans",
      provider: "mymemory",
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("api.mymemory.translated.net/get");
    expect(String(url)).toContain("langpair=Autodetect");
    expect(String(url)).toContain("zh-CN");
    expect(init?.method).toBe("GET");
  });

  it("posts Google gtx form when provider=google", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([[["你好", "hello"]]]),
    );
    const out = await translateSelectionText("hello", {
      target: "zh-Hans",
      provider: "google",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toEqual({
      ok: true,
      text: "你好",
      target: "zh-Hans",
      provider: "google",
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("translate.googleapis.com");
    expect(String(init?.body)).toContain("client=gtx");
    expect(String(init?.body)).toContain("tl=zh-CN");
  });

  it("auto-races Bing∥Youdao and accepts the first success", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes("edge.microsoft.com")) {
        await new Promise((r) => setTimeout(r, 40));
        throw new TypeError("fetch failed");
      }
      if (href.includes("aidemo.youdao.com")) {
        return jsonResponse({ errorCode: "0", translation: ["你好"] });
      }
      throw new Error(`unexpected url ${href}`);
    });
    const out = await translateSelectionText("hello", {
      target: "zh-Hans",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toEqual({
      ok: true,
      text: "你好",
      target: "zh-Hans",
      provider: "youdao",
    });
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("auto-falls to wave-2 MyMemory after primary wave misses", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes("edge.microsoft.com") || href.includes("aidemo.youdao.com")) {
        throw new TypeError("Failed to fetch");
      }
      if (href.includes("mymemory")) {
        return jsonResponse({
          responseStatus: 200,
          responseData: { translatedText: "你好" },
        });
      }
      if (href.includes("googleapis")) {
        throw new TypeError("fetch failed");
      }
      throw new Error(`unexpected url ${href}`);
    });
    const out = await translateSelectionText("hello", {
      target: "zh-Hans",
      provider: "auto",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toEqual({
      ok: true,
      text: "你好",
      target: "zh-Hans",
      provider: "mymemory",
    });
  });

  it("silently flips Asian→en echo into a Chinese result", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = String(input);
      const body = String(init?.body ?? "");
      // Primary for kana is en — echo no-op, then answer zh-Hans.
      if (href.includes("edge.microsoft.com")) {
        const toEn = href.includes("to=en");
        return jsonResponse([
          { translations: [{ text: toEn ? "こんにちは" : "你好" }] },
        ]);
      }
      if (href.includes("aidemo.youdao.com")) {
        const toEn = body.includes("to=en");
        return jsonResponse({
          errorCode: "0",
          translation: [toEn ? "こんにちは" : "你好"],
        });
      }
      throw new TypeError("fetch failed");
    });
    const out = await translateSelectionText("こんにちは", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.target).toBe("zh-Hans");
    expect(out.text).toBe("你好");
  });

  it("rejects Latin→Latin as a useless auto flip", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = String(input);
      const body = String(init?.body ?? "");
      const toZh = href.includes("to=zh-Hans") || body.includes("to=zh-CHS");
      // zh echoes; en returns case-only "translation" — both useless.
      if (href.includes("edge.microsoft.com")) {
        return jsonResponse([{ translations: [{ text: toZh ? "hello" : "HELLO" }] }]);
      }
      if (href.includes("aidemo.youdao.com")) {
        return jsonResponse({
          errorCode: "0",
          translation: [toZh ? "hello" : "HELLO"],
        });
      }
      throw new TypeError("fetch failed");
    });
    const out = await translateSelectionText("hello", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out.ok).toBe(false);
  });

  it("aborts race losers once a provider wins", async () => {
    let bingSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = String(input);
      if (href.includes("edge.microsoft.com")) {
        bingSignal = init?.signal;
        await new Promise<void>((resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(signal.reason ?? new Error("aborted"));
            return;
          }
          signal?.addEventListener(
            "abort",
            () => reject(signal.reason ?? new Error("aborted")),
            { once: true },
          );
        });
      }
      if (href.includes("aidemo.youdao.com")) {
        await new Promise((r) => setTimeout(r, 5));
        return jsonResponse({ errorCode: "0", translation: ["你好"] });
      }
      throw new TypeError("fetch failed");
    });
    const out = await translateSelectionText("hello", {
      target: "zh-Hans",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toEqual({
      ok: true,
      text: "你好",
      target: "zh-Hans",
      provider: "youdao",
    });
    expect(bingSignal?.aborted).toBe(true);
  });

  it("returns aggregated diagnostics without throwing when every source misses", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const out = await translateSelectionText("hello", {
      target: "zh-Hans",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("bing:");
    expect(out.error).toContain("youdao:");
    expect(out.error).toContain("mymemory:");
    expect(out.error).toContain("google:");
  });

  it("skips MyMemory for oversized byte payloads", async () => {
    const big = "字".repeat(200); // >500 UTF-8 bytes
    const fetchImpl = vi.fn(async () => {
      throw new Error("should not call fetch for mymemory-only oversized");
    });
    const out = await translateSelectionText(big, {
      target: "en",
      provider: "mymemory",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/mymemory skipped/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
