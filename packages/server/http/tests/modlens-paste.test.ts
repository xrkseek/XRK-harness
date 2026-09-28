import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  handleModlensHttp,
  handleModlensRpc,
  parseModlensPastePreview,
} from "../src/dsh-compat/modlens.js";

describe("modlens paste preview", () => {
  it("extracts urls engines and model tokens heuristically", () => {
    const text =
      "Use claude-3.5 and codex\nhttps://example.com/a\nhttps://example.com/a";
    const items = parseModlensPastePreview(text);
    expect(items.some((r) => r.kind === "url" && r.value === "https://example.com/a")).toBe(
      true,
    );
    expect(items.filter((r) => r.kind === "url").length).toBe(1);
    expect(items.some((r) => r.kind === "engine" && r.value === "codex")).toBe(true);
    expect(items.some((r) => r.kind === "model" && r.value === "claude-3.5")).toBe(true);
    expect(items.some((r) => r.kind === "lines")).toBe(true);
  });

  it("returns tagged incomplete envelope from RPC paste", () => {
    const body = handleModlensRpc(
      "paste",
      { text: "gpt-4o on https://x.test" },
      {},
    );
    expect(body.incomplete).toEqual(["modlens-host"]);
    expect(body.preview).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
    expect((body.items as Array<{ kind: string }>).length).toBeGreaterThan(0);
  });
});

describe("modlens paste takeover HTTP", () => {
  let home: string;

  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  async function withServer(
    run: (port: number) => Promise<void>,
  ): Promise<void> {
    home = mkdtempSync(path.join(tmpdir(), "xrk-modlens-"));
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const claimed = await handleModlensHttp(req, res, url.pathname, {
          xrkHome: home,
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
      await run(port);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  }

  it("GET /modlens/paste returns takeover so the client hijacks paste", async () => {
    await withServer(async (port) => {
      const res = await fetch(
        `http://127.0.0.1:${port}/modlens/paste?model=gpt-4o`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { takeover?: boolean };
      expect(body.takeover).toBe(true);
    });
  });

  it("POST binary paste returns a durable path under ~/.xrk", async () => {
    await withServer(async (port) => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      const res = await fetch(`http://127.0.0.1:${port}/modlens/paste`, {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: png,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { path?: string };
      expect(typeof body.path).toBe("string");
      expect(body.path!.includes(path.join("modlens", "pastes"))).toBe(true);
      expect(readFileSync(body.path!).equals(png)).toBe(true);
    });
  });

  it("POST JSON paste still returns heuristic preview items", async () => {
    await withServer(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/modlens/paste`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "https://example.com gpt-4o" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items?: unknown[]; preview?: boolean };
      expect(body.preview).toBe(true);
      expect(Array.isArray(body.items)).toBe(true);
      expect((body.items as unknown[]).length).toBeGreaterThan(0);
    });
  });
});
