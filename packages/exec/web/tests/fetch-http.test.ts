import { describe, expect, it } from "vitest";
import {
  classifyContentType,
  createHttpFetchProvider,
} from "../src/fetch-http.js";
import { WebError } from "../src/types.js";

function jsonHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({ "content-type": "text/plain; charset=utf-8", ...extra });
}

describe("classifyContentType", () => {
  it("maps html / text / json and rejects binary", () => {
    expect(classifyContentType("text/html; charset=utf-8")).toBe("html");
    expect(classifyContentType("application/json")).toBe("text");
    expect(classifyContentType("image/png")).toBeUndefined();
    expect(classifyContentType(null)).toBeUndefined();
  });
});

describe("createHttpFetchProvider", () => {
  it("fetches text, follows same-origin redirects, and keeps non-2xx", async () => {
    const calls: string[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method}:${url}`);
      if (url === "https://example.com/go") {
        return new Response(null, {
          status: 302,
          headers: { location: "/page" },
        });
      }
      return new Response("<p>hi</p>", {
        status: 404,
        headers: { "content-type": "text/html" },
      });
    };
    const provider = createHttpFetchProvider({ fetch: fetchFn });
    const out = await provider.fetch({ url: "https://example.com/go" });
    expect(out.statusCode).toBe(404);
    expect(out.body.kind).toBe("html");
    expect(out.body.content).toContain("hi");
    expect(calls).toEqual([
      "GET:https://example.com/go",
      "GET:https://example.com/page",
    ]);
  });

  it("refuses cross-origin redirects and private hosts", async () => {
    const provider = createHttpFetchProvider({
      fetch: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/x" },
        }),
    });
    await expect(
      provider.fetch({ url: "https://example.com/a" }),
    ).rejects.toMatchObject({ code: "WEB_REDIRECT_BLOCKED" });
    await expect(
      createHttpFetchProvider({ fetch: async () => new Response("x") }).fetch({
        url: "http://127.0.0.1/",
      }),
    ).rejects.toBeInstanceOf(WebError);
  });

  it("rejects unsupported content types", async () => {
    const provider = createHttpFetchProvider({
      fetch: async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    });
    await expect(
      provider.fetch({ url: "https://example.com/a.png" }),
    ).rejects.toMatchObject({ code: "WEB_UNSUPPORTED_CONTENT_TYPE" });
  });

  it("sends the product user-agent", async () => {
    let ua = "";
    const provider = createHttpFetchProvider({
      fetch: async (_input, init) => {
        ua = new Headers(init?.headers).get("user-agent") ?? "";
        return new Response("ok", { headers: jsonHeaders() });
      },
    });
    await provider.fetch({ url: "https://example.com/" });
    expect(ua).toContain("xrk-harness/");
    expect(ua).toContain("github.com/xrkseek");
  });
});
