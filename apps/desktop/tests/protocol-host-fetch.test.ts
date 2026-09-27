import { describe, expect, it, vi } from "vitest";
import {
  fetchDesktopHostFromProtocol,
  isDesktopFaceEventStream,
} from "../src/protocol-host-fetch.js";

describe("protocol-host-fetch", () => {
  it("detects SSE content types", () => {
    expect(
      isDesktopFaceEventStream(
        new Response(null, {
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        }),
      ),
    ).toBe(true);
    expect(
      isDesktopFaceEventStream(
        new Response(null, { headers: { "content-type": "application/json" } }),
      ),
    ).toBe(false);
  });

  it("buffers POST bodies and non-SSE responses for the Host pipe", async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.method).toBe("POST");
      expect(await request.text()).toBe('{"rpcId":"1"}');
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const host = { fetch } as never;
    const res = await fetchDesktopHostFromProtocol(
      host,
      new Request("xrk-app://app/api/host.describe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"rpcId":"1"}',
      }),
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":true}');
  });

  it("passes SSE bodies through without buffering", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(": connected\n\n"));
      },
    });
    const fetch = vi.fn(async () =>
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      }),
    );
    const res = await fetchDesktopHostFromProtocol(
      { fetch } as never,
      new Request("xrk-app://app/api/events.mux"),
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.body).not.toBeNull();
  });
});
