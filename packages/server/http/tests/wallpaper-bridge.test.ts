import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  options: { method?: string; body?: Buffer | string; xrkHome: string },
): Promise<{ status: number; json?: Record<string, unknown>; headers: Headers }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleWallpaperHttp(req, res, pathname, { xrkHome: options.xrkHome });
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
    const json = ctype.includes("json")
      ? ((await res.json()) as Record<string, unknown>)
      : undefined;
    return { status: res.status, json, headers: res.headers };
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
});

/** Tiny PNG used as upload fixture (same bytes as Host placeholder). */
const PLACEHOLDER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
