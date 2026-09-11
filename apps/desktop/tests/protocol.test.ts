import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachDesktopNavigationGuard,
  desktopAppIndexUrl,
  DESKTOP_PROTOCOL_PRIVILEGES,
  DESKTOP_PROTOCOL_SCHEME,
  handleDesktopProtocolRequest,
  isDesktopProtocolUrl,
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
    expect(desktopAppIndexUrl()).toBe("xrk-app://app/index.html");
  });

  it("serves version-matched static assets and refuses traversal", async () => {
    const webRoot = tempRoot({
      "index.html": "<html>ok</html>",
      "assets/app.js": "console.log(1)",
    });
    const ok = await serveDesktopStaticAsset(
      webRoot,
      new Request("xrk-app://app/index.html"),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toMatch(/text\/html/u);
    await expect(ok.text()).resolves.toBe("<html>ok</html>");

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

    const staticApp = await handleDesktopProtocolRequest(
      new Request("xrk-app://app/index.html"),
      { webRoot },
    );
    expect(await staticApp.text()).toBe("web");
  });

  it("guards navigation to non-protocol URLs", () => {
    expect(isDesktopProtocolUrl("xrk-app://app/index.html")).toBe(true);
    expect(isDesktopProtocolUrl("https://evil.example/")).toBe(false);

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
  });
});
