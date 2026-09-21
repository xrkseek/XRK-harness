import { describe, expect, it } from "vitest";
import {
  createBrowserSession,
  createCdpBrowserSession,
  resolveCdpDebuggerUrl,
  type CdpCaller,
} from "../src/browser-cdp.js";
import { createBrowserTools } from "../src/browser-tools.js";

function scriptedCdp(): { caller: CdpCaller; methods: string[] } {
  const methods: string[] = [];
  const caller: CdpCaller = {
    async call(method, params) {
      methods.push(method);
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
            { role: { value: "none" }, ignored: true, backendDOMNodeId: 9 },
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
    close() {},
  };
  return { caller, methods };
}

describe("resolveCdpDebuggerUrl", () => {
  it("keeps a browser websocket and discovers HTTP roots", async () => {
    const ws = "ws://127.0.0.1:9222/devtools/browser/abc";
    await expect(resolveCdpDebuggerUrl(ws, async () => ({}))).resolves.toBe(ws);
    await expect(
      resolveCdpDebuggerUrl("http://127.0.0.1:9222", async () => ({
        webSocketDebuggerUrl: ws,
      })),
    ).resolves.toBe(ws);
  });
});

describe("createCdpBrowserSession", () => {
  it("opens through CDP and keeps @eN refs for act", async () => {
    const scripted = scriptedCdp();
    const session = createCdpBrowserSession({
      rawUrl: "http://127.0.0.1:9222",
      resolve: async () => "ws://127.0.0.1:9222/devtools/browser/abc",
      connect: async () => scripted.caller,
    });
    const opened = await session.open("https://example.test/");
    expect(opened.text).toContain("@e1 [link] Go");
    expect(opened.text).toContain("@e2 [textbox] q");
    const acted = await session.act({ ref: "@e1", action: "click" });
    expect(acted.note).toContain("@e1");
    expect(scripted.methods).toContain("Target.createTarget");
    expect(scripted.methods).toContain("Runtime.callFunctionOn");
    const tools = createBrowserTools(session, {
      saveScreenshot: async (png) => ({
        attachmentId: "sha256:shot",
        mediaType: "image/png",
        bytes: png.byteLength,
        width: 1,
        height: 1,
        name: "browser-snapshot.png",
      }),
    });
    const vision = tools.find((tool) => tool.name === "browser_vision")!;
    const seen = await vision.execute({ question: "what is on screen" });
    expect(seen.isError).toBeFalsy();
    expect(Array.isArray(seen.content)).toBe(true);
    const blocks = seen.content as { type: string; attachment?: { attachmentId: string } }[];
    expect(blocks.some((block) => block.type === "image" && block.attachment?.attachmentId === "sha256:shot")).toBe(true);
    expect(scripted.methods).toContain("Page.captureScreenshot");
  });
});

describe("createBrowserSession", () => {
  it("stays on the HTTP snapshot when no CDP url is set", async () => {
    const session = createBrowserSession({
      fetch: {
        async fetch({ url }) {
          return {
            url,
            statusCode: 200,
            truncated: false,
            body: {
              kind: "html",
              content: "<html><a href=\"/n\">Next</a></html>",
            },
          };
        },
      },
      env: {},
    });
    const snap = await session.open("https://example.test/start");
    expect(snap.text).toContain("@e1");
  });
});
