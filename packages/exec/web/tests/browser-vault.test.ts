import { describe, expect, it } from "vitest";
import {
  createBrowserVaultTools,
  createHttpBrowserSession,
  createHttpFetchProvider,
} from "../src/index.js";
import type { BrowserVaultAccess } from "../src/browser-vault-tools.js";

describe("browser_vault tools", () => {
  it("lists opaque handles without secrets", async () => {
    const secrets = new Map([["web.tavily", "sk-secret-never-echo"]]);
    const vault: BrowserVaultAccess = {
      list: () => [
        { handle: "web.tavily", label: "Tavily API key", kind: "credential" },
      ],
      peek: (h) => secrets.get(h),
    };
    const session = createHttpBrowserSession({
      fetch: createHttpFetchProvider({
        fetch: async () =>
          new Response(
            '<html><body><input type="password" name="k"></body></html>',
            { status: 200, headers: { "content-type": "text/html" } },
          ),
      }),
    });
    const [listTool, fillTool] = createBrowserVaultTools(session, vault);
    const listed = await listTool!.execute({});
    expect(String(listed.content)).toContain("handle=web.tavily");
    expect(String(listed.content)).not.toContain("sk-secret");

    await session.open("https://example.com/login");
    const snap = await session.snapshot();
    const refMatch = /@e(\d+)/.exec(snap.text) ?? /e(\d+)/.exec(snap.text);
    expect(refMatch).toBeTruthy();
    const filled = await fillTool!.execute({
      handle: "web.tavily",
      ref: `e${refMatch![1]}`,
    });
    expect(filled.isError).toBeFalsy();
    expect(String(filled.content)).toContain('"success":true');
    expect(String(filled.content)).not.toContain("sk-secret");
  });

  it("refuses unknown handles", async () => {
    const vault: BrowserVaultAccess = {
      list: () => [],
      peek: () => undefined,
    };
    const session = createHttpBrowserSession({
      fetch: createHttpFetchProvider({
        fetch: async () =>
          new Response("<html></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      }),
    });
    const [, fillTool] = createBrowserVaultTools(session, vault);
    const filled = await fillTool!.execute({ handle: "missing", ref: "e1" });
    expect(filled.isError).toBe(true);
  });
});
