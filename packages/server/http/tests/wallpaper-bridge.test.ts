import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  handleWallpaperHttp,
  isWallpaperHttpPath,
} from "../src/dsh-compat/wallpaper.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

async function invoke(
  pathname: string,
  options: {
    method?: string;
    body?: Buffer | string;
    xrkHome: string;
    pluginsDir?: string;
  },
): Promise<{ status: number; json?: Record<string, unknown>; headers: Headers; bytes?: ArrayBuffer }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleWallpaperHttp(req, res, pathname, {
      xrkHome: options.xrkHome,
      ...(options.pluginsDir ? { pluginsDir: options.pluginsDir } : {}),
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  try {
    const body = options.body;
    const headers: Record<string, string> = {};
    if (typeof body === "string") headers["content-type"] = "application/json";
    else if (body) headers["content-type"] = "application/octet-stream";
    const res = await fetch(`http://127.0.0.1:${addr.port}${pathname}`, {
      method: options.method ?? "GET",
      headers: Object.keys(headers).length ? headers : undefined,
      body,
    });
    const ctype = res.headers.get("content-type") ?? "";
    if (ctype.includes("json")) {
      return {
        status: res.status,
        json: (await res.json()) as Record<string, unknown>,
        headers: res.headers,
      };
    }
    return {
      status: res.status,
      headers: res.headers,
      bytes: await res.arrayBuffer(),
    };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

describe("wallpaper bridge", () => {
  it("matches wallpaper and scene root paths", () => {
    expect(isWallpaperHttpPath("/wallpaper-engine/inventory")).toBe(true);
    expect(isWallpaperHttpPath("/scene-frame/x")).toBe(true);
    expect(isWallpaperHttpPath("/api/local-assets")).toBe(true);
    expect(isWallpaperHttpPath("/other")).toBe(false);
  });

  it("returns picker-shaped inventory for uploads only", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-we-"));
    temps.push(home);
    const upload = path.join(home, "wallpaper-engine", "uploads");
    // ensure dir via first inventory call
    await invoke("/wallpaper-engine/inventory", { xrkHome: home });
    writeFileSync(path.join(upload, "up-demo.png"), Buffer.from(PLACEHOLDER));
    const res = await invoke("/wallpaper-engine/inventory", { xrkHome: home });
    expect(res.status).toBe(200);
    expect(res.json?.ok).toBe(true);
    expect(res.json?.weAssetsAvailable).toBe(false);
    const walls = res.json?.wallpapers as Record<string, unknown>[];
    expect(walls).toHaveLength(1);
    expect(walls[0]?.type).toBe("image");
    expect(walls[0]?.playable).toBe(true);
    expect(String(walls[0]?.media)).toContain("/wallpaper-engine/media/");
  });

  it("serves upload media bytes and 404s unknown tokens", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-we-m-"));
    temps.push(home);
    await invoke("/wallpaper-engine/inventory", { xrkHome: home });
    const upload = path.join(home, "wallpaper-engine", "uploads");
    writeFileSync(path.join(upload, "up-a.png"), Buffer.from(PLACEHOLDER));
    const ok = await invoke("/wallpaper-engine/media/up-a.png", {
      xrkHome: home,
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("image/png");
    const miss = await invoke("/wallpaper-engine/media/missing.png", {
      xrkHome: home,
    });
    expect(miss.status).toBe(404);
    expect(miss.json?.ok).toBe(false);
  });

  it("persists settings and accepts namespace writes", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-we-s-"));
    temps.push(home);
    const put = await invoke("/wallpaper-engine/settings/core", {
      method: "PUT",
      body: JSON.stringify({ blur: 22, activeId: "up-a.png" }),
      xrkHome: home,
    });
    expect(put.status).toBe(200);
    expect(put.json?.ok).toBe(true);
    const get = await invoke("/wallpaper-engine/settings", { xrkHome: home });
    const settings = get.json?.settings as Record<string, unknown>;
    expect(settings?.blur).toBe(22);
    expect(settings?.activeId).toBe("up-a.png");
  });

  it("refuses ffmpeg-derived routes with an honest note", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-we-t-"));
    temps.push(home);
    const res = await invoke("/wallpaper-engine/transcoded/tok", {
      xrkHome: home,
    });
    expect(res.json?.ok).toBe(false);
    expect(String(res.json?.note)).toMatch(/ffmpeg/i);
  });

  it("serves staged assets/rope for /rope-art/<name>.png", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-we-rope-"));
    temps.push(home);
    const pluginsDir = path.join(home, "plugins");
    const pkg = path.join(
      pluginsDir,
      "web",
      "plugins",
      "dsh-plugin-wallpaper-engine",
    );
    const ropeDir = path.join(pkg, "assets", "rope");
    mkdirSync(ropeDir, { recursive: true });
    writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: "dsh-plugin-wallpaper-engine", version: "0.0.0" }),
    );
    const png = Buffer.from(PLACEHOLDER);
    writeFileSync(path.join(ropeDir, "deepseek.png"), png);

    const ok = await invoke("/wallpaper-engine/rope-art/deepseek.png", {
      xrkHome: home,
      pluginsDir,
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("image/png");
    expect(ok.bytes?.byteLength).toBe(png.length);

    const miss = await invoke("/wallpaper-engine/rope-art/missing.png", {
      xrkHome: home,
      pluginsDir,
    });
    expect(miss.status).toBe(404);
    expect(miss.json?.ok).toBe(false);

    const traversal = await invoke(
      "/wallpaper-engine/rope-art/..%2Fpackage.json",
      { xrkHome: home, pluginsDir },
    );
    expect(traversal.status).toBe(404);
  });

  it("serves staged lib/about for /about-qr/<name> and 404s missing art", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-we-about-"));
    temps.push(home);
    const pluginsDir = path.join(home, "plugins");
    const pkg = path.join(
      pluginsDir,
      "web",
      "plugins",
      "dsh-plugin-wallpaper-engine",
    );
    const aboutDir = path.join(pkg, "lib", "about");
    mkdirSync(aboutDir, { recursive: true });
    writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: "dsh-plugin-wallpaper-engine", version: "0.0.0" }),
    );
    const png = Buffer.from(PLACEHOLDER);
    writeFileSync(path.join(aboutDir, "qq-group.png"), png);

    const ok = await invoke("/wallpaper-engine/about-qr/qq-group.png", {
      xrkHome: home,
      pluginsDir,
    });
    expect(ok.status).toBe(200);
    expect(ok.bytes?.byteLength).toBe(png.length);

    const miss = await invoke("/wallpaper-engine/about-qr/missing.png", {
      xrkHome: home,
      pluginsDir,
    });
    expect(miss.status).toBe(404);
    expect(miss.json?.error).toBe("about-qr-not-found");
  });

  it("404s missing mascot instead of painting a 1×1 stub", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-we-mascot-"));
    temps.push(home);
    const res = await invoke("/wallpaper-engine/mascot/custom-abcd.png", {
      xrkHome: home,
    });
    expect(res.status).toBe(404);
    expect(res.json?.ok).toBe(false);
    expect(res.headers.get("content-type")).toContain("json");
  });
});

/** Tiny opaque PNG used as upload / staged-art fixture. */
const PLACEHOLDER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
