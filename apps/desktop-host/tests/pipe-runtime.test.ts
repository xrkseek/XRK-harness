import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  DesktopHostResponseDecoder,
  encodeDesktopRequestData,
  encodeDesktopRequestEnd,
  encodeDesktopRequestStart,
  writeDesktopPipeFrame,
} from "@xrkseek/harness-desktop";
import { startDesktopHostPipeRuntime } from "../src/pipe-runtime.js";

describe("desktop-host pipe runtime", () => {
  it("decodes a framed request and writes a framed Fetch response", async () => {
    const request = new PassThrough();
    const response = new PassThrough();
    const decoder = new DesktopHostResponseDecoder();
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
    });

    const runtime = startDesktopHostPipeRuntime(
      async (req) => {
        expect(req.method).toBe("GET");
        expect(new URL(req.url).pathname).toBe("/health");
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      { request, response },
    );

    await writeDesktopPipeFrame(
      request,
      encodeDesktopRequestStart(1, {
        url: "xrk-app://app/health",
        method: "GET",
        headers: [],
        hasBody: false,
      }),
    );

    const deadline = Date.now() + 5_000;
    let frames: ReturnType<DesktopHostResponseDecoder["push"]> = [];
    while (Date.now() < deadline) {
      const buf = Buffer.concat(chunks);
      chunks.length = 0;
      if (buf.length > 0) {
        frames = [...frames, ...decoder.push(buf)];
      }
      if (frames.some((f) => f.type === "end")) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(frames[0]).toMatchObject({
      type: "start",
      streamId: 1,
      status: 200,
      hasBody: true,
    });
    const data = frames.filter((f) => f.type === "data");
    expect(data.length).toBeGreaterThan(0);
    const body = Buffer.concat(
      data.map((f) => (f.type === "data" ? f.data : Buffer.alloc(0))),
    ).toString("utf8");
    expect(JSON.parse(body)).toEqual({ ok: true });
    expect(frames.at(-1)).toMatchObject({ type: "end", streamId: 1 });

    await runtime.dispose();
  });

  it("forwards POST body bytes into Fetch", async () => {
    const request = new PassThrough();
    const response = new PassThrough();
    let seenBody = "";
    const runtime = startDesktopHostPipeRuntime(
      async (req) => {
        seenBody = await req.text();
        return new Response("ok", { status: 201, headers: { "x-echo": "1" } });
      },
      { request, response },
    );

    const done = new Promise<void>((resolve, reject) => {
      const decoder = new DesktopHostResponseDecoder();
      response.on("data", (chunk: Buffer) => {
        try {
          for (const frame of decoder.push(chunk)) {
            if (frame.type === "start") {
              expect(frame.status).toBe(201);
            }
            if (frame.type === "end") resolve();
            if (frame.type === "error") reject(new Error(frame.message));
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    await writeDesktopPipeFrame(
      request,
      encodeDesktopRequestStart(7, {
        url: "http://desktop.local/api/echo",
        method: "POST",
        headers: [["content-type", "text/plain"]],
        hasBody: true,
      }),
    );
    await writeDesktopPipeFrame(
      request,
      encodeDesktopRequestData(7, Buffer.from("hello-pipe")),
    );
    await writeDesktopPipeFrame(request, encodeDesktopRequestEnd(7));
    await done;
    expect(seenBody).toBe("hello-pipe");
    await runtime.dispose();
  });
});
