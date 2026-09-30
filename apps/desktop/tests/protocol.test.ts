import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachDesktopNavigationGuard,
  desktopAppIndexUrl,
  desktopLoopbackIndexUrl,
  desktopSplashUrl,
  DESKTOP_PROTOCOL_PRIVILEGES,
  DESKTOP_PROTOCOL_SCHEME,
  handleDesktopProtocolRequest,
  isDesktopHostForwardPath,
  isDesktopLoopbackUrl,
  isDesktopProtocolUrl,
  isDesktopStaticAssetPath,
  resolveDesktopAssetPath,
  serveDesktopStaticAsset,
} from "../src/protocol.js";

const roots: string[] = [];

function tempRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "xrk-desktop-protocol-"));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("desktop custom protocol", () => {
  it("locks scheme privileges for xrk-app", () => {
    expect(DESKTOP_PROTOCOL_SCHEME).toBe("xrk-app");
    expect(DESKTOP_PROTOCOL_PRIVILEGES.scheme).toBe("xrk-app");
    expect(DESKTOP_PROTOCOL_PRIVILEGES.privileges.supportFetchAPI).toBe(true);
    expect(DESKTOP_PROTOCOL_PRIVILEGES.privileges.corsEnabled).toBe(true);
    expect(desktopAppIndexUrl()).toMatch(
      /^xrk-app:\/\/app\/index\.html\?.*dsh-desktop-mode=advanced/,
    );
    expect(desktopAppIndexUrl()).toContain("dsh-desktop-titlebar-inset=36");
    expect(
      desktopAppIndexUrl(DESKTOP_PROTOCOL_SCHEME, { platform: "win32" }),
    ).toContain("dsh-desktop-platform=win32");
    expect(desktopSplashUrl()).toMatch(
      /^xrk-app:\/\/app\/desktop-splash\.html\?.*dsh-desktop-mode=advanced/,
    );
    expect(
      desktopSplashUrl(DESKTOP_PROTOCOL_SCHEME, { platform: "darwin" }),
    ).toContain("dsh-desktop-platform=darwin");
    expect(
      desktopSplashUrl(DESKTOP_PROTOCOL_SCHEME, {
        platform: "win32",
        colorScheme: "dark",
      }),
    ).toContain("dsh-desktop-color-scheme=dark");
  });

  it("serves version-matched static assets and refuses traversal", async () => {
    const webRoot = tempRoot({
      "index.html": "<html><head></head><body>ok</body></html>",
      "boot.json": JSON.stringify({ rev: "t", entries: [] }),
      "assets/app.js": "console.log(1)",
    });
    const ok = await serveDesktopStaticAsset(
      webRoot,
      new Request("xrk-app://app/index.html"),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toMatch(/text\/html/u);
    const html = await ok.text();
    expect(html).toContain("window.__XRK_BOOT__=");
    expect(html).toContain('"rev":"t"');
    expect(html).toContain("ok");

    const js = await serveDesktopStaticAsset(
      webRoot,
      new Request("xrk-app://app/assets/app.js"),
    );
    expect(js.headers.get("content-type")).toMatch(/javascript/u);

    const missing = await serveDesktopStaticAsset(
      webRoot,
      new Request("xrk-app://app/missing.html"),
    );
    expect(missing.status).toBe(404);
    // URL parsers collapse `/../`; refuse via explicit pathname resolution.
    expect(resolveDesktopAssetPath(webRoot, "/../secret")).toBeUndefined();
    expect(resolveDesktopAssetPath(webRoot, "/../../etc/passwd")).toBeUndefined();
  });

  it("routes shell vs app and forwards app Fetch when provided", async () => {
    const webRoot = tempRoot({ "index.html": "web" });
    const shellRoot = tempRoot({ "plugin.html": "shell" });
    const fetchApp = vi.fn(async () => new Response("from-host", { status: 201 }));

    const shell = await handleDesktopProtocolRequest(
      new Request("xrk-app://shell/plugin.html"),
      { webRoot, shellRoot },
    );
    expect(await shell.text()).toBe("shell");

    const missingHost = await handleDesktopProtocolRequest(
      new Request("xrk-app://other/x"),
      { webRoot },
    );
    expect(missingHost.status).toBe(404);

    const viaHost = await handleDesktopProtocolRequest(
      new Request("xrk-app://app/api/session", { method: "POST", body: "{}" }),
      { webRoot, fetchApp },
    );
    expect(viaHost.status).toBe(201);
    expect(fetchApp).toHaveBeenCalledOnce();

    fetchApp.mockClear();
    const streamSse = await handleDesktopProtocolRequest(
      new Request("xrk-app://stream/api/events.mux"),
      { webRoot, fetchApp },
    );
    expect(streamSse.status).toBe(201);
    expect(fetchApp).toHaveBeenCalledOnce();

    fetchApp.mockClear();
    const sidebarTree = await handleDesktopProtocolRequest(
      new Request("xrk-app://app/sidebar/api/fs.tree", {
        method: "POST",
        body: "{}",
      }),
      { webRoot, fetchApp },
    );
    expect(sidebarTree.status).toBe(201);
    expect(fetchApp).toHaveBeenCalledOnce();

    fetchApp.mockClear();
    // Product HTML paints from disk even when Host Fetch is up (first paint).
    const indexFromDisk = await handleDesktopProtocolRequest(
      new Request("xrk-app://app/index.html"),
      { webRoot, fetchApp },
    );
    expect(await indexFromDisk.text()).toBe("web");
    expect(fetchApp).not.toHaveBeenCalled();

    fetchApp.mockClear();
    const rootFromDisk = await handleDesktopProtocolRequest(
      new Request("xrk-app://app/"),
      { webRoot, fetchApp },
    );
    expect(await rootFromDisk.text()).toBe("web");
    expect(fetchApp).not.toHaveBeenCalled();

    fetchApp.mockClear();
    const staticCss = await handleDesktopProtocolRequest(
      new Request("xrk-app://app/assets/app.css"),
      {
        webRoot: tempRoot({ "assets/app.css": "body{}" }),
        fetchApp,
      },
    );
    expect(await staticCss.text()).toBe("body{}");
    expect(fetchApp).not.toHaveBeenCalled();

    fetchApp.mockClear();
    const missingPlugin = await handleDesktopProtocolRequest(
      new Request("xrk-app://app/plugins/@community/foo/client.js"),
      { webRoot, fetchApp },
    );
    expect(missingPlugin.status).toBe(201);
    expect(fetchApp).toHaveBeenCalledOnce();

    const staticApp = await handleDesktopProtocolRequest(
      new Request("xrk-app://app/index.html"),
      { webRoot },
    );
    expect(await staticApp.text()).toBe("web");

    const overlayRoot = tempRoot({
      "boot.json": JSON.stringify({
        rev: "ov",
        entries: [
          {
            id: "dsh-niulai-pet",
            url: "/plugins/dsh-niulai-pet/client.js",
            rev: "1",
          },
        ],
      }),
      "plugins/dsh-niulai-pet/client.js": "/* pet */",
    });
    const productWithBoot = tempRoot({
      "index.html": "<html><head></head><body>web</body></html>",
      "boot.json": JSON.stringify({ rev: "prod", entries: [] }),
    });
    const withOverlay = await handleDesktopProtocolRequest(
      new Request("xrk-app://app/index.html"),
      { webRoot: productWithBoot, overlayRoot },
    );
    const html = await withOverlay.text();
    expect(html).toContain("dsh-niulai-pet");
    const pet = await handleDesktopProtocolRequest(
      new Request("xrk-app://app/plugins/dsh-niulai-pet/client.js"),
      { webRoot: productWithBoot, overlayRoot },
    );
    expect(await pet.text()).toBe("/* pet */");

    // @liustack/modlens probes Host before mounting settings.plugin.item;
    // static webRoot must not answer 404 and skip the Configurable card.
    fetchApp.mockClear();
    const modlens = await handleDesktopProtocolRequest(
      new Request("xrk-app://app/modlens/config"),
      { webRoot, fetchApp },
    );
    expect(modlens.status).toBe(201);
    expect(fetchApp).toHaveBeenCalledOnce();

    fetchApp.mockClear();
    const communityRoot = await handleDesktopProtocolRequest(
      new Request("xrk-app://app/whale-girl"),
      { webRoot, fetchApp },
    );
    expect(communityRoot.status).toBe(201);
    expect(fetchApp).toHaveBeenCalledOnce();

    fetchApp.mockClear();
    const missingAsset = await handleDesktopProtocolRequest(
      new Request("xrk-app://app/assets/missing.css"),
      { webRoot, fetchApp },
    );
    expect(missingAsset.status).toBe(404);
    expect(fetchApp).not.toHaveBeenCalled();

    // Mutating Host verbs must not hit serveDesktopStaticAsset's 405 gate
    // (market install · modlens config save · pty input).
    fetchApp.mockClear();
    const marketPost = await handleDesktopProtocolRequest(
      new Request("xrk-app://app/dsh-market/install", {
        method: "POST",
        body: "{}",
      }),
      { webRoot, fetchApp },
    );
    expect(marketPost.status).toBe(201);
    expect(fetchApp).toHaveBeenCalledOnce();

    fetchApp.mockClear();
    const unlistedGet = await handleDesktopProtocolRequest(
      new Request("xrk-app://app/dsh-market/updates"),
      { webRoot, fetchApp },
    );
    expect(unlistedGet.status).toBe(201);
    expect(fetchApp).toHaveBeenCalledOnce();
  });

  it("classifies Host forward vs static asset paths", () => {
    expect(isDesktopHostForwardPath("/modlens/config")).toBe(true);
    expect(isDesktopHostForwardPath("/_dsh/genui/x")).toBe(true);
    expect(isDesktopHostForwardPath("/assets/app.css")).toBe(false);
    expect(isDesktopStaticAssetPath("/assets/app.css")).toBe(true);
    expect(isDesktopStaticAssetPath("/modlens/config")).toBe(false);
  });

  it("guards navigation to non-protocol / non-loopback URLs", () => {
    expect(isDesktopProtocolUrl("xrk-app://app/index.html")).toBe(true);
    expect(isDesktopProtocolUrl("https://evil.example/")).toBe(false);
    expect(isDesktopLoopbackUrl("http://127.0.0.1:43129/index.html")).toBe(true);
    expect(isDesktopLoopbackUrl("http://localhost:43129/")).toBe(false);
    expect(isDesktopLoopbackUrl("https://evil.example/")).toBe(false);
    expect(
      desktopLoopbackIndexUrl("http://127.0.0.1:43129", { platform: "win32" }),
    ).toMatch(
      /^http:\/\/127\.0\.0\.1:43129\/index\.html\?.*dsh-desktop-mode=advanced/,
    );
    expect(
      desktopLoopbackIndexUrl("http://127.0.0.1:43129", {
        platform: "win32",
        colorScheme: "dark",
      }),
    ).toContain("dsh-desktop-color-scheme=dark");

    const preventDefault = vi.fn();
    let listener:
      | ((event: { preventDefault(): void }, url: string) => void)
      | undefined;
    attachDesktopNavigationGuard({
      on: (_event, next) => {
        listener = next;
      },
    });
    listener?.({ preventDefault }, "https://evil.example/");
    expect(preventDefault).toHaveBeenCalledOnce();
    preventDefault.mockClear();
    listener?.({ preventDefault }, "xrk-app://app/index.html");
    expect(preventDefault).not.toHaveBeenCalled();
    listener?.({ preventDefault }, "http://127.0.0.1:43129/index.html");
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
