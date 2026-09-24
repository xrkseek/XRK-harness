import { describe, expect, it } from "vitest";
import { createBrowserRuntimeRegistry } from "../src/browser-runtime-registry.js";
import { createHttpBrowserSession } from "../src/browser-session.js";
import {
  BROWSER_ERROR,
  createBrowserTools,
} from "../src/browser-tools.js";
import {
  createCdpBrowserSession,
  type CdpCaller,
} from "../src/browser-cdp.js";
import type { WebFetch, WebFetchResult } from "../src/types.js";

function htmlFetch(pages: Record<string, string>): WebFetch {
  return {
    async fetch({ url }): Promise<WebFetchResult> {
      const content = pages[url];
      if (content === undefined) {
        throw new Error(`missing page ${url}`);
      }
      return {
        url,
        statusCode: 200,
        truncated: false,
        body: { kind: "html", content },
      };
    },
  };
}

function scriptedCdp(): { caller: CdpCaller; closed: { value: boolean } } {
  const closed = { value: false };
  const caller: CdpCaller = {
    async call(method, params) {
      if (method === "Target.createTarget") return { targetId: "t1" };
      if (method === "Target.attachToTarget") return { sessionId: "s1" };
      if (method === "Runtime.evaluate") {
        const expression = String(params?.expression ?? "");
        if (expression === "location.href") {
          return { result: { value: "https://example.test/" } };
        }
        return { result: { value: "Example" } };
      }
      if (method === "Accessibility.getFullAXTree") {
        return {
          nodes: [
            {
              role: { value: "link" },
              name: { value: "Go" },
              backendDOMNodeId: 7,
            },
            {
              role: { value: "textbox" },
              name: { value: "q" },
              backendDOMNodeId: 8,
            },
          ],
        };
      }
      if (method === "DOM.resolveNode") return { object: { objectId: "obj" } };
      if (method === "Page.captureScreenshot") {
        return {
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        };
      }
      return {};
    },
    close() {
      closed.value = true;
    },
  };
  return { caller, closed };
}

describe("createBrowserRuntimeRegistry", () => {
  it("reuses one BrowserSession per sessionId and disposes on drop", async () => {
    const registry = createBrowserRuntimeRegistry();
    let factories = 0;
    const a = registry.getOrCreate("s1", () => {
      factories += 1;
      return createHttpBrowserSession({
        fetch: htmlFetch({
          "https://example.com/": `<html><title>Home</title><a href="/n">N</a></html>`,
          "https://example.com/n": `<html><title>N</title></html>`,
        }),
      });
    });
    const again = registry.getOrCreate("s1", () => {
      factories += 1;
      throw new Error("factory must not run again");
    });
    expect(again).toBe(a);
    expect(factories).toBe(1);
    await a.open("https://example.com/");
    const other = registry.getOrCreate("s2", () =>
      createHttpBrowserSession({
        fetch: htmlFetch({
          "https://example.com/": `<html><title>Other</title></html>`,
        }),
      }),
    );
    expect(other).not.toBe(a);
    expect(registry.size()).toBe(2);
    registry.drop("s1");
    expect(registry.get("s1")).toBeUndefined();
    expect(registry.size()).toBe(1);
    await expect(a.snapshot()).rejects.toThrow(/no open page/);
    registry.dispose();
    expect(registry.size()).toBe(0);
  });

  it("CDP dispose closes the websocket caller", async () => {
    const registry = createBrowserRuntimeRegistry();
    const scripted = scriptedCdp();
    const session = registry.getOrCreate("cdp-1", () =>
      createCdpBrowserSession({
        rawUrl: "http://127.0.0.1:9222",
        resolve: async () => "ws://127.0.0.1:9222/devtools/browser/abc",
        connect: async () => scripted.caller,
      }),
    );
    await session.open("https://example.test/");
    registry.drop("cdp-1");
    expect(scripted.closed.value).toBe(true);
  });
});

describe("browser_* failure classification", () => {
  it("surfaces WebError.code on tool results", async () => {
    const session = createHttpBrowserSession({
      fetch: htmlFetch({
        "https://example.com/": `<html><a href="/x">X</a></html>`,
      }),
    });
    const tools = createBrowserTools(session);
    const vision = tools.find((t) => t.name === "browser_vision")!;
    const noGraphics = await vision.execute({});
    expect(noGraphics.isError).toBe(true);
    expect(noGraphics.error?.code).toBe(BROWSER_ERROR.NO_GRAPHICS);

    const act = tools.find((t) => t.name === "browser_act")!;
    const noPage = await act.execute({ ref: "e1", action: "click" });
    expect(noPage.isError).toBe(true);
    expect(noPage.error?.code).toBe(BROWSER_ERROR.NO_PAGE);

    const open = tools.find((t) => t.name === "browser_open")!;
    await open.execute({ url: "https://example.com/" });
    const badRef = await act.execute({ ref: "e99", action: "click" });
    expect(badRef.isError).toBe(true);
    expect(badRef.error?.code).toBe(BROWSER_ERROR.BAD_REF);
  });

  it("classifies missing attachment store for vision", async () => {
    const scripted = scriptedCdp();
    const session = createCdpBrowserSession({
      rawUrl: "http://127.0.0.1:9222",
      resolve: async () => "ws://127.0.0.1:9222/devtools/browser/abc",
      connect: async () => scripted.caller,
    });
    await session.open("https://example.test/");
    const tools = createBrowserTools(session);
    const vision = tools.find((t) => t.name === "browser_vision")!;
    const missed = await vision.execute({});
    expect(missed.isError).toBe(true);
    expect(missed.error?.code).toBe(BROWSER_ERROR.NO_ATTACHMENTS);
  });
});

describe("open → act → vision loop", () => {
  it("keeps page state across tools and returns image + @eN text", async () => {
    const scripted = scriptedCdp();
    const registry = createBrowserRuntimeRegistry();
    const session = registry.getOrCreate("loop", () =>
      createCdpBrowserSession({
        rawUrl: "http://127.0.0.1:9222",
        resolve: async () => "ws://127.0.0.1:9222/devtools/browser/abc",
        connect: async () => scripted.caller,
      }),
    );
    const tools = createBrowserTools(session, {
      saveScreenshot: async (png) => ({
        attachmentId: "sha256:loop-shot",
        mediaType: "image/png",
        bytes: png.byteLength,
        width: 1,
        height: 1,
        name: "browser-snapshot.png",
      }),
    });
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    const opened = await byName.browser_open!.execute({
      url: "https://example.test/",
    });
    expect(opened.isError).toBeFalsy();
    expect(String(opened.content)).toContain("@e1");

    const acted = await byName.browser_act!.execute({
      ref: "@e1",
      action: "click",
    });
    expect(acted.isError).toBeFalsy();
    expect(String(acted.content)).toContain("@e1");

    // Simulate agent invalidate: same registry key must still hold the page.
    const again = registry.getOrCreate("loop", () => {
      throw new Error("must reuse shared runtime");
    });
    expect(again).toBe(session);

    const seen = await byName.browser_vision!.execute({
      question: "what is on screen",
    });
    expect(seen.isError).toBeFalsy();
    expect(Array.isArray(seen.content)).toBe(true);
    const blocks = seen.content as {
      type: string;
      text?: string;
      attachment?: { attachmentId: string };
    }[];
    expect(
      blocks.some(
        (b) =>
          b.type === "image" &&
          b.attachment?.attachmentId === "sha256:loop-shot",
      ),
    ).toBe(true);
    expect(
      blocks.some((b) => b.type === "text" && String(b.text).includes("@e")),
    ).toBe(true);
  });
});
