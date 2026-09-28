/**
 * free-search raw-search envelope (injected search — no live network).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { handleFreeSearchHttp } from "../src/dsh-compat/free-search.js";

const temps: string[] = [];

afterEach(() => {
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

async function withFreeSearch(
  home: string,
  search: {
    search: (
      request: { query: string; maxResults: number },
    ) => Promise<{
      sources: Array<{ url: string; title?: string; snippet?: string }>;
      truncated: boolean;
    }>;
  },
  run: (base: string) => Promise<void>,
): Promise<void> {
  const server = createServer((req, res) => {
    void handleFreeSearchHttp(
      req,
      res,
      req.url?.split("?")[0] ?? "/",
      { xrkHome: home, search },
    ).then((claimed) => {
      if (!claimed) {
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

describe("free-search raw-search", () => {
  it("returns client value envelope from keyless ddg", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-fs-raw-"));
    temps.push(home);
    await withFreeSearch(
      home,
      {
        async search() {
          return {
            sources: [
              {
                url: "https://example.com/a",
                title: "Alpha",
                snippet: "first hit",
              },
            ],
            truncated: false,
          };
        },
      },
      async (base) => {
        const res = await (
          await fetch(`${base}/api/dsh-free-search-settings/raw-search`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ query: "alpha", maxResults: 5 }),
          })
        ).json();
        expect(res).toMatchObject({
          ok: true,
          value: {
            provider: "ddg",
            sources: [
              {
                url: "https://example.com/a",
                title: "Alpha",
                snippet: "first hit",
              },
            ],
            content: "",
          },
        });
      },
    );
  });

  it("rejects empty query", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-fs-rej-"));
    temps.push(home);
    await withFreeSearch(
      home,
      {
        async search() {
          return { sources: [], truncated: false };
        },
      },
      async (base) => {
        const res = await (
          await fetch(`${base}/api/dsh-free-search-settings/raw-search`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ query: "" }),
          })
        ).json();
        expect(res).toMatchObject({
          ok: false,
          code: "search-rejected",
        });
      },
    );
  });
});
