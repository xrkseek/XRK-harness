/**
 * Face transport regression suite (Desktop pipe stack).
 *
 * Locks the failure modes that shipped as 「连接中」/ empty sessions /
 * `Controller is already closed (internal)` on session.prompt:
 *
 * 1. Long-lived SSE must not serialize-block unary on the Host pipe
 * 2. Cancelling an SSE body must not throw into the next Face write
 * 3. `xrk-app://stream` must map onto the in-process Face HTTP authority
 * 4. Stacked dispatch → pipe must keep unary alive while SSE stays open
 * 5. mux **and** host SSE both open on `stream` without starving unary
 */

import { createServer } from "node:http";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  DesktopHostResponseDecoder,
  encodeDesktopRequestCancel,
  encodeDesktopRequestData,
  encodeDesktopRequestEnd,
  encodeDesktopRequestStart,
  writeDesktopPipeFrame,
} from "@xrkseek/harness-desktop";
import { dispatchHttpServerFetch } from "@xrkseek/server-http";
import { startDesktopHostPipeRuntime } from "../src/pipe-runtime.js";

function collectEnds(
  response: PassThrough,
  timeoutMs = 5_000,
): {
  starts: number[];
  ended: Set<number>;
  bodies: Map<number, Buffer>;
  waitForEnd: (streamId: number) => Promise<void>;
} {
  const decoder = new DesktopHostResponseDecoder();
  const starts: number[] = [];
  const ended = new Set<number>();
  const bodies = new Map<number, Buffer>();
  response.on("data", (chunk: Buffer) => {
    for (const frame of decoder.push(chunk)) {
      if (frame.type === "start") {
        starts.push(frame.streamId);
        bodies.set(frame.streamId, Buffer.alloc(0));
      }
      if (frame.type === "data") {
        const prev = bodies.get(frame.streamId) ?? Buffer.alloc(0);
        bodies.set(frame.streamId, Buffer.concat([prev, frame.data]));
      }
      if (frame.type === "end" || frame.type === "error") {
        ended.add(frame.streamId);
      }
    }
  });
  return {
    starts,
    ended,
    bodies,
    waitForEnd: async (streamId) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && !ended.has(streamId)) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(ended.has(streamId)).toBe(true);
    },
  };
}

describe("Face transport regressions", () => {
  it("maps xrk-app://stream onto Face HTTP and keeps unary off the SSE queue", async () => {
    const seen: string[] = [];
    const request = new PassThrough();
    const response = new PassThrough();
    const { starts, ended, bodies, waitForEnd } = collectEnds(response);

    const runtime = startDesktopHostPipeRuntime(
      async (req) => {
        const url = new URL(req.url);
        seen.push(`${req.method} ${url.protocol}//${url.host}${url.pathname}`);
        if (url.pathname === "/api/events.mux") {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(": connected\n\n"));
              },
            }),
            {
              status: 200,
              headers: { "content-type": "text/event-stream; charset=utf-8" },
            },
          );
        }
        return new Response(JSON.stringify({ ok: true, path: url.pathname }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      { request, response },
    );

    await writeDesktopPipeFrame(
      request,
      encodeDesktopRequestStart(1, {
        url: "xrk-app://stream/api/events.mux",
        method: "GET",
        headers: [],
        hasBody: false,
      }),
    );
    await writeDesktopPipeFrame(
      request,
      encodeDesktopRequestStart(2, {
        url: "xrk-app://app/api/host.describe",
        method: "POST",
        headers: [["content-type", "application/json"]],
        hasBody: true,
      }),
    );
    await writeDesktopPipeFrame(
      request,
      encodeDesktopRequestData(2, Buffer.from("{}")),
    );
    await writeDesktopPipeFrame(request, encodeDesktopRequestEnd(2));

    await waitForEnd(2);
    expect(starts).toEqual(expect.arrayContaining([1, 2]));
    expect(ended.has(1)).toBe(false);
    expect(JSON.parse(bodies.get(2)!.toString("utf8"))).toEqual({
      ok: true,
      path: "/api/host.describe",
    });
    expect(seen).toEqual([
      "GET http://desktop.local/api/events.mux",
      "POST http://desktop.local/api/host.describe",
    ]);

    await runtime.dispose();
  });

  it("maps host SSE onto xrk-app://stream alongside mux without blocking unary", async () => {
    const seen: string[] = [];
    const request = new PassThrough();
    const response = new PassThrough();
    const { starts, ended, bodies, waitForEnd } = collectEnds(response);

    const runtime = startDesktopHostPipeRuntime(
      async (req) => {
        const url = new URL(req.url);
        seen.push(`${req.method} ${url.protocol}//${url.host}${url.pathname}`);
        if (
          url.pathname === "/api/events.mux" ||
          url.pathname === "/api/events.host"
        ) {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(": connected\n\n"));
              },
            }),
            {
              status: 200,
              headers: { "content-type": "text/event-stream; charset=utf-8" },
            },
          );
        }
        return new Response(JSON.stringify({ ok: true, path: url.pathname }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      { request, response },
    );

    await writeDesktopPipeFrame(
      request,
      encodeDesktopRequestStart(1, {
        url: "xrk-app://stream/api/events.mux",
        method: "GET",
        headers: [],
        hasBody: false,
      }),
    );
    await writeDesktopPipeFrame(
      request,
      encodeDesktopRequestStart(2, {
        url: "xrk-app://stream/api/events.host",
        method: "GET",
        headers: [],
        hasBody: false,
      }),
    );
    await writeDesktopPipeFrame(
      request,
      encodeDesktopRequestStart(3, {
        url: "xrk-app://app/api/settings.describe",
        method: "POST",
        headers: [["content-type", "application/json"]],
        hasBody: true,
      }),
    );
    await writeDesktopPipeFrame(
      request,
      encodeDesktopRequestData(3, Buffer.from("{}")),
    );
    await writeDesktopPipeFrame(request, encodeDesktopRequestEnd(3));

    await waitForEnd(3);
    expect(starts).toEqual(expect.arrayContaining([1, 2, 3]));
    expect(ended.has(1)).toBe(false);
    expect(ended.has(2)).toBe(false);
    expect(JSON.parse(bodies.get(3)!.toString("utf8"))).toEqual({
      ok: true,
      path: "/api/settings.describe",
    });
    expect(seen).toEqual([
      "GET http://desktop.local/api/events.mux",
      "GET http://desktop.local/api/events.host",
      "POST http://desktop.local/api/settings.describe",
    ]);

    await runtime.dispose();
  });

  it("cancels an open SSE stream without blocking a later unary", async () => {
    const request = new PassThrough();
    const response = new PassThrough();
    const { ended, bodies, waitForEnd } = collectEnds(response);
    let muxFetches = 0;

    const runtime = startDesktopHostPipeRuntime(
      async (req) => {
        const path = new URL(req.url).pathname;
        if (path === "/api/events.mux") {
          muxFetches += 1;
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(":ok\n\n"));
                req.signal.addEventListener(
                  "abort",
                  () => {
                    void controller.error(new Error("aborted"));
                  },
                  { once: true },
                );
              },
            }),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          );
        }
        return new Response('{"alive":true}', {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      { request, response },
    );

    await writeDesktopPipeFrame(
      request,
      encodeDesktopRequestStart(1, {
        url: "xrk-app://stream/api/events.mux",
        method: "GET",
        headers: [],
        hasBody: false,
      }),
    );
    await new Promise((r) => setTimeout(r, 30));
    await writeDesktopPipeFrame(request, encodeDesktopRequestCancel(1));
    await writeDesktopPipeFrame(
      request,
      encodeDesktopRequestStart(2, {
        url: "xrk-app://app/api/session.list",
        method: "POST",
        headers: [["content-type", "application/json"]],
        hasBody: true,
      }),
    );
    await writeDesktopPipeFrame(
      request,
      encodeDesktopRequestData(2, Buffer.from("{}")),
    );
    await writeDesktopPipeFrame(request, encodeDesktopRequestEnd(2));

    await waitForEnd(2);
    expect(muxFetches).toBe(1);
    expect(ended.has(2)).toBe(true);
    expect(bodies.get(2)!.toString("utf8")).toBe('{"alive":true}');

    await runtime.dispose();
  });

  it("stacks http.Server SSE dispatch under the pipe without poisoning prompt-path writes", async () => {
    let muxWrites = 0;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://desktop.local");
      if (url.pathname === "/api/events.mux") {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
        });
        res.write(": connected\n\n");
        const tick = setInterval(() => {
          muxWrites += 1;
          if (!res.writableEnded && !res.destroyed) {
            res.write(
              `data: ${JSON.stringify({ type: "server-request", n: muxWrites })}\n\n`,
            );
          }
        }, 15);
        const stop = (): void => {
          clearInterval(tick);
        };
        req.on("close", stop);
        res.on("close", stop);
        return;
      }
      if (url.pathname === "/api/session.prompt" && req.method === "POST") {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              type: "server-response",
              result: { ok: true, value: { accepted: true }, echo: body.length },
            }),
          );
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const request = new PassThrough();
    const response = new PassThrough();
    const { ended, bodies, waitForEnd } = collectEnds(response);
    const runtime = startDesktopHostPipeRuntime(
      (req) => dispatchHttpServerFetch(server, req),
      { request, response },
    );

    await writeDesktopPipeFrame(
      request,
      encodeDesktopRequestStart(1, {
        url: "xrk-app://stream/api/events.mux",
        method: "GET",
        headers: [],
        hasBody: false,
      }),
    );
    await new Promise((r) => setTimeout(r, 40));

    // Cancel mux the way Electron does on reconnect — must not throw on later Face writes.
    await writeDesktopPipeFrame(request, encodeDesktopRequestCancel(1));
    await new Promise((r) => setTimeout(r, 40));

    await writeDesktopPipeFrame(
      request,
      encodeDesktopRequestStart(2, {
        url: "xrk-app://app/api/session.prompt",
        method: "POST",
        headers: [["content-type", "application/json"]],
        hasBody: true,
      }),
    );
    await writeDesktopPipeFrame(
      request,
      encodeDesktopRequestData(
        2,
        Buffer.from(
          JSON.stringify({
            type: "client-request",
            method: "session.prompt",
            payload: { text: "1" },
          }),
        ),
      ),
    );
    await writeDesktopPipeFrame(request, encodeDesktopRequestEnd(2));

    await waitForEnd(2);
    const prompt = JSON.parse(bodies.get(2)!.toString("utf8")) as {
      result: { ok: boolean };
    };
    expect(prompt.result.ok).toBe(true);
    expect(ended.has(2)).toBe(true);
    expect(muxWrites).toBeGreaterThan(0);

    await runtime.dispose();
    server.close();
  });
});
