import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FACE_CONSOLE_BOOT,
  XRK_APP_SHELL_BOOT,
  applyXrkProductBootPolicy,
  createHttpServer,
  injectBootIntoHtml,
  mergeWebBootManifests,
  resolveStaticPath,
} from "../src/index.js";
import { createMemorySessionStore, newSession } from "@xrkseek/core-session";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { createMinimalComposition } from "@xrkseek/preset-minimal";

describe("boot inject", () => {
  it("injects app-shell roster before </head>", () => {
    const html = "<html><head><title>x</title></head><body></body></html>";
    const out = injectBootIntoHtml(html, XRK_APP_SHELL_BOOT);
    expect(out).toContain("__DSH_BOOT__");
    expect(out).toContain("__XRK_BOOT__");
    expect(out).toContain("xrk-face-console");
    expect(out.indexOf("__DSH_BOOT__")).toBeLessThan(out.indexOf("</head>"));
  });

  it("console boot still injectable", () => {
    const out = injectBootIntoHtml("<head></head>", FACE_CONSOLE_BOOT);
    expect(out).toContain("xrk-face-console");
  });

  it("mergeWebBootManifests lets extra ids replace", () => {
    const merged = mergeWebBootManifests(
      {
        rev: "base",
        entries: [
          { id: "keep", url: "/a.js", rev: "1", inject: [] },
          { id: "swap", url: "/old.js", rev: "1", inject: [] },
        ],
      },
      {
        rev: "extra",
        entries: [
          { id: "swap", url: "/new.js", rev: "2", inject: [] },
          { id: "added", url: "/b.js", rev: "2", inject: [] },
        ],
      },
    );
    expect(merged.rev).toBe("base+extra");
    expect(merged.entries.map((e) => e.id)).toEqual(["keep", "swap", "added"]);
    expect(merged.entries.find((e) => e.id === "swap")?.url).toBe("/new.js");
  });

  it("product boot policy drops Cordis chrome and HMR ids", () => {
    const filtered = applyXrkProductBootPolicy({
      rev: "cap",
      entries: [
        {
          id: "@deepseek-ai/dsh-client-runtime",
          url: "/plugins/runtime.js",
          rev: "1",
          inject: [],
        },
        {
          id: "@deepseek-ai/dsh-client-ui-cordis",
          url: "/plugins/cordis.js",
          rev: "1",
          inject: [],
        },
        {
          id: "@deepseek-ai/dsh-cordis-client-runner",
          url: "/plugins/runner.js",
          rev: "1",
          inject: [],
        },
        {
          id: "@deepseek-ai/dsh-client-hmr",
          url: "/plugins/hmr.js",
          rev: "1",
          inject: [],
        },
      ],
    });
    expect(filtered.entries.map((e) => e.id)).toEqual([
      "@deepseek-ai/dsh-client-runtime",
    ]);
  });
});

describe("resolveStaticPath", () => {
  it("blocks path escape", () => {
    const root = path.resolve("/tmp/xrk-static-root");
    expect(resolveStaticPath(root, "/../../etc/passwd")).toBeNull();
  });

  it("maps / to index.html", () => {
    const root = path.resolve("/tmp/xrk-static-root");
    const p = resolveStaticPath(root, "/");
    expect(p?.endsWith(`index.html`)).toBe(true);
  });
});

describe("http webStatic", () => {
  it("serves index with boot inject without API key", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-web-"));
    await writeFile(
      path.join(dir, "index.html"),
      "<!doctype html><html><head><title>XRK</title></head><body><div id='root'></div></body></html>",
      "utf8",
    );
    await mkdir(path.join(dir, "assets"));
    await writeFile(path.join(dir, "assets", "app.js"), "console.log(1)", "utf8");

    const store = createMemorySessionStore();
    newSession(store);
    const http = createHttpServer({
      host: "127.0.0.1",
      port: 0,
      apiKey: "secret",
      corsOrigin: "*",
      rateLimitPerMinute: 1000,
      store,
      ensureSession: (id) => id ?? store.list()[0]!,
      resolveAgent: async (sessionId) =>
        createMinimalComposition({
          workspaceRoot: process.cwd(),
          sessionStore: store,
          sessionId,
          assemble: true,
          llm: createReplayAdapter([{ content: "x" }]),
        }).createAgent(),
      webStatic: {
        root: dir,
        transformIndex: (html) => injectBootIntoHtml(html, XRK_APP_SHELL_BOOT),
      },
    });

    const { port } = await http.listen();
    const base = `http://127.0.0.1:${port}`;

    const index = await fetch(`${base}/`);
    expect(index.status).toBe(200);
    const text = await index.text();
    expect(text).toContain("__DSH_BOOT__");
    expect(text).toContain("xrk-face-console");

    const asset = await fetch(`${base}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("console.log(1)");

    // API still auth
    const unauth = await fetch(`${base}/api/host.describe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rpcId: "1", payload: {} }),
    });
    expect(unauth.status).toBe(401);

    await http.close();
  });

  it("serves extraRoots overlay and 404s missing /plugins/", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-web-"));
    const overlay = await mkdtemp(path.join(tmpdir(), "xrk-overlay-"));
    await writeFile(
      path.join(dir, "index.html"),
      "<!doctype html><html><head></head><body>app</body></html>",
      "utf8",
    );
    const pluginDir = path.join(overlay, "plugins", "@acme", "extra");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(path.join(pluginDir, "client.js"), "export default 1", "utf8");

    const store = createMemorySessionStore();
    newSession(store);
    const http = createHttpServer({
      host: "127.0.0.1",
      port: 0,
      apiKey: "secret",
      corsOrigin: "*",
      rateLimitPerMinute: 1000,
      store,
      ensureSession: (id) => id ?? store.list()[0]!,
      resolveAgent: async (sessionId) =>
        createMinimalComposition({
          workspaceRoot: process.cwd(),
          sessionStore: store,
          sessionId,
          assemble: true,
          llm: createReplayAdapter([{ content: "x" }]),
        }).createAgent(),
      webStatic: {
        root: dir,
        extraRoots: [overlay],
      },
    });

    const { port } = await http.listen();
    const base = `http://127.0.0.1:${port}`;

    const extra = await fetch(`${base}/plugins/@acme/extra/client.js`);
    expect(extra.status).toBe(200);
    expect(await extra.text()).toBe("export default 1");

    const missing = await fetch(`${base}/plugins/@acme/missing/client.js`);
    expect(missing.status).toBe(404);

    await http.close();
  });
});

describe("http API-only landing", () => {
  it("GET / returns HTML when webStatic unset", async () => {
    const store = createMemorySessionStore();
    newSession(store);
    const http = createHttpServer({
      host: "127.0.0.1",
      port: 0,
      apiKey: "",
      corsOrigin: "*",
      rateLimitPerMinute: 1000,
      store,
      ensureSession: (id) => id ?? store.list()[0]!,
      resolveAgent: async (sessionId) =>
        createMinimalComposition({
          workspaceRoot: process.cwd(),
          sessionStore: store,
          sessionId,
          assemble: true,
          llm: createReplayAdapter([{ content: "x" }]),
        }).createAgent(),
    });
    const { port } = await http.listen();
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const text = await res.text();
    expect(text).toContain("XRK-Harness");
    expect(text).toContain("/health");
    await http.close();
  });
});
