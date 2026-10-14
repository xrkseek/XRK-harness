// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { translateSelectionText } from "../src/selection-translate.ts";

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

  it("posts to Bing Edge and returns translated text", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify([{ translations: [{ text: "你好" }] }]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const out = await translateSelectionText("hello", {
      target: "zh-Hans",
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

  it("posts Google gtx form when provider=google", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([[["你好", "hello"]]]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
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
});
