import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  handleNiulaiKwsHttp,
  isNiulaiKwsPath,
} from "../src/dsh-compat/niulai-kws.js";
import { createServer } from "node:http";

describe("niulai-kws static assets", () => {
  let home: string;

  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it("matches /niulai-kws paths", () => {
    expect(isNiulaiKwsPath("/niulai-kws")).toBe(true);
    expect(isNiulaiKwsPath("/niulai-kws/kws-worker.js")).toBe(true);
    expect(isNiulaiKwsPath("/modlens")).toBe(false);
  });

  it("serves allowlisted files from staged kws/", async () => {
    home = mkdtempSync(path.join(tmpdir(), "xrk-niulai-"));
    const kwsDir = path.join(
      home,
      "web",
      "plugins",
      "dsh-niulai-pet",
      "kws",
    );
    mkdirSync(kwsDir, { recursive: true });
    const body = "worker-ok";
    writeFileSync(path.join(kwsDir, "kws-worker.js"), body);

    const server = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const claimed = await handleNiulaiKwsHttp(req, res, url.pathname, {
          pluginsDir: home,
        });
        if (!claimed) {
          res.writeHead(404);
          res.end("no");
        }
      })();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const { port } = server.address() as { port: number };
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/niulai-kws/kws-worker.js`,
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(body);
      const denied = await fetch(
        `http://127.0.0.1:${port}/niulai-kws/../package.json`,
      );
      expect(denied.status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
