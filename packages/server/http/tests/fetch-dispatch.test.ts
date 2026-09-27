import { createServer } from "node:http";
import { createReadStream, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dispatchHttpServerFetch } from "../src/fetch-dispatch.js";

describe("dispatchHttpServerFetch", () => {
  it("preserves Content-Type from writeHead object form (Desktop pipe)", async () => {
    const server = createServer((req, res) => {
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "content-length": 3,
      });
      res.end("abc");
    });

    const response = await dispatchHttpServerFetch(
      server,
      new Request("http://desktop.local/assets/app.js"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(await response.text()).toBe("abc");
  });

  it("preserves Content-Type when writeHead then pipe (static.js path)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xrk-fetch-dispatch-"));
    const file = join(dir, "app.js");
    writeFileSync(file, "export default 1;\n");

    const server = createServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "content-length": 16,
      });
      createReadStream(file).pipe(res);
    });

    const response = await dispatchHttpServerFetch(
      server,
      new Request("http://desktop.local/assets/app.js"),
    );
    expect(response.headers.get("content-type")).toMatch(/javascript/);
    expect(await response.text()).toContain("export default");
  });

  it("preserves headers set via setHeader before end", async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end('{"ok":true}');
    });

    const response = await dispatchHttpServerFetch(
      server,
      new Request("http://desktop.local/api/x"),
    );
    expect(response.headers.get("content-type")).toMatch(/json/);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("drops Face SSE writes after the Fetch body is cancelled", async () => {
    let writeAfterCancel: (() => void) | undefined;
    let sawClose = false;
    const server = createServer((req, res) => {
      req.on("close", () => {
        sawClose = true;
      });
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      res.write(": connected\n\n");
      writeAfterCancel = () => {
        res.write('data: {"type":"server-request"}\n\n');
      };
    });

    const response = await dispatchHttpServerFetch(
      server,
      new Request("http://desktop.local/api/events.mux"),
    );
    expect(response.headers.get("content-type")).toMatch(/event-stream/);
    await response.body!.cancel();
    expect(() => writeAfterCancel?.()).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    expect(sawClose).toBe(true);
  });

  it("tears down Node request on AbortSignal so Face can unsubscribe", async () => {
    let sawClose = false;
    const server = createServer((req, res) => {
      req.on("close", () => {
        sawClose = true;
      });
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      res.write(": connected\n\n");
    });
    const abort = new AbortController();
    const response = await dispatchHttpServerFetch(
      server,
      new Request("http://desktop.local/api/events.mux", {
        signal: abort.signal,
      }),
    );
    expect(response.status).toBe(200);
    abort.abort();
    await new Promise((r) => setTimeout(r, 30));
    expect(sawClose).toBe(true);
  });

  it("serves a later unary after a cancelled SSE without throwing Controller closed", async () => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://desktop.local");
      if (url.pathname === "/api/events.mux") {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
        });
        res.write(": connected\n\n");
        const timer = setInterval(() => {
          if (!res.writableEnded && !res.destroyed) {
            res.write("data: tick\n\n");
          }
        }, 10);
        const stop = (): void => {
          clearInterval(timer);
        };
        req.on("close", stop);
        res.on("close", stop);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });

    const sse = await dispatchHttpServerFetch(
      server,
      new Request("http://desktop.local/api/events.mux"),
    );
    await sse.body!.cancel();
    await new Promise((r) => setTimeout(r, 30));

    const unary = await dispatchHttpServerFetch(
      server,
      new Request("http://desktop.local/api/host.describe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(unary.status).toBe(200);
    expect(await unary.text()).toBe('{"ok":true}');
    server.close();
  });
});
