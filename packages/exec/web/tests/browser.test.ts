import { describe, expect, it } from "vitest";
import { extractBrowserElements } from "../src/browser-html.js";
import { createHttpBrowserSession } from "../src/browser-session.js";
import { createBrowserTools } from "../src/browser-tools.js";
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

describe("browser-html", () => {
  it("extracts refs for links and inputs", () => {
    const els = extractBrowserElements(
      `<html><a href="/next">Go</a><input type="text" name="q" value="hi"/><button>OK</button></html>`,
    );
    expect(els.map((e) => e.ref)).toEqual(["e1", "e2", "e3"]);
    expect(els[0]?.role).toBe("link");
    expect(els[0]?.href).toBe("/next");
    expect(els[1]?.role).toBe("textbox");
    expect(els[2]?.role).toBe("button");
  });
});

describe("createHttpBrowserSession", () => {
  it("open → snapshot → click navigates", async () => {
    const session = createHttpBrowserSession({
      fetch: htmlFetch({
        "https://example.com/": `<html><title>Home</title><a href="/next">Next</a></html>`,
        "https://example.com/next": `<html><title>Next</title><input name="q"/></html>`,
      }),
    });
    const open = await session.open("https://example.com/");
    expect(open.title).toBe("Home");
    expect(open.text).toContain("@e1");
    const acted = await session.act({ ref: "e1", action: "click" });
    expect(acted.url).toBe("https://example.com/next");
    expect(acted.note).toContain("navigated");
    expect(acted.text).toContain("title: Next");
  });

  it("type stores field value in snapshot", async () => {
    const session = createHttpBrowserSession({
      fetch: htmlFetch({
        "https://example.com/": `<html><input type="text" name="q"/></html>`,
      }),
    });
    await session.open("https://example.com/");
    const typed = await session.act({
      ref: "@e1",
      action: "type",
      text: "hello",
    });
    expect(typed.note).toContain("typed");
    expect(typed.text).toContain('"hello"');
  });
});

describe("createBrowserTools", () => {
  it("registers browser_open / snapshot / act", async () => {
    const session = createHttpBrowserSession({
      fetch: htmlFetch({
        "https://example.com/": `<a href="/x">X</a>`,
        "https://example.com/x": `<title>X</title>`,
      }),
    });
    const tools = createBrowserTools(session);
    expect(tools.map((t) => t.name)).toEqual([
      "browser_open",
      "browser_snapshot",
      "browser_act",
      "browser_vision",
    ]);
    const open = tools[0]!;
    const snap = await open.execute({ url: "https://example.com/" });
    expect(snap.isError).toBeFalsy();
    expect(String(snap.content)).toContain("@e1");
    const vision = tools.find((tool) => tool.name === "browser_vision")!;
    const missed = await vision.execute({});
    expect(missed.isError).toBe(true);
    expect(String(missed.content)).toContain("no graphical browser");
    expect(missed.error?.code).toBe("WEB_BROWSER_NO_GRAPHICS");
    expect(String(missed.content)).not.toContain("@e1");
  });
});
