import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDshCompatPublicHandler } from "../src/index.js";

const temps: string[] = [];

afterEach(() => {
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

async function withServer(
  pluginsDir: string | undefined,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const handler = createDshCompatPublicHandler({
    ...(pluginsDir ? { pluginsDir } : {}),
  });
  const server = createServer((req, res) => {
    void handler(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end("no");
      }
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  try {
    await run(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe("dsh-update /api/update", () => {
  it("returns client-shaped status without staged aggregate (mode missing)", async () => {
    await withServer(undefined, async (base) => {
      const res = await fetch(`${base}/api/update/status`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        mode: string;
        packages: unknown[];
        outdated: boolean;
      };
      expect(body.mode).toBe("missing");
      expect(Array.isArray(body.packages)).toBe(true);
      expect(body.packages).toHaveLength(0);
      expect(body.outdated).toBe(false);
    });
  });

  it("reports staged @linxin666/dsh-web-all as up-to-date npm status", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-dsh-update-"));
    temps.push(root);
    const pkgDir = path.join(root, "web", "plugins", "@linxin666", "dsh-web-all");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "@linxin666/dsh-web-all", version: "0.4.4" }),
    );

    await withServer(root, async (base) => {
      const res = await fetch(`${base}/api/update/status`);
      const body = (await res.json()) as {
        mode: string;
        anchor: string;
        outdated: boolean;
        packages: Array<{ name: string; current: string; latest: string }>;
      };
      expect(body.mode).toBe("npm");
      expect(body.anchor).toBe("@linxin666/dsh-web-all");
      expect(body.outdated).toBe(false);
      expect(body.packages[0]).toEqual({
        name: "@linxin666/dsh-web-all",
        current: "0.4.4",
        latest: "0.4.4",
      });
    });
  });

  it("refuses POST /api/update/run with link errorCode", async () => {
    await withServer(undefined, async (base) => {
      const res = await fetch(`${base}/api/update/run`, { method: "POST" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        errorCode: string;
        exitCode: number | null;
      };
      expect(body.ok).toBe(false);
      expect(body.errorCode).toBe("link");
      expect(body.exitCode).toBeNull();
    });
  });
});
