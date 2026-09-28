/**
 * Desktop `xrk-app://` WebApiClient carrier knobs (stream base + dual SSE).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { WebApiClient } from "../src/client/web-api-client.ts";

class ProbeClient extends WebApiClient {
  readonly fetches: string[] = [];
  streamBase(): string {
    return this.resolveStreamBase();
  }
  protected override doFetch(input: URL, init?: RequestInit): Promise<Response> {
    this.fetches.push(`${init?.method ?? "GET"} ${input.href}`);
    if (input.pathname.includes("events.mux") || input.pathname.includes("events.host")) {
      return Promise.resolve(
        new Response(": connected\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ type: "server-response", rpcId: "x", result: { ok: true, value: {} } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }
}

describe("WebApiClient Desktop carrier", () => {
  const previousLocation = globalThis.location;

  afterEach(() => {
    Object.defineProperty(globalThis, "location", {
      value: previousLocation,
      configurable: true,
    });
    vi.unstubAllGlobals();
  });

  it("resolves SSE against xrk-app://stream while unary stays on app origin", async () => {
    Object.defineProperty(globalThis, "location", {
      value: { origin: "xrk-app://app", protocol: "xrk-app:", hostname: "app" },
      configurable: true,
    });
    const client = new ProbeClient();
    expect(client.streamBase()).toBe("xrk-app://stream");

    const ac = new AbortController();
    const mux = client.events.mux({}, ac.signal);
    const iter = mux[Symbol.asyncIterator]();
    // Kick the SSE open (headers path).
    const first = iter.next();
    await Promise.race([first, new Promise((r) => setTimeout(r, 50))]);
    ac.abort();

    expect(client.fetches.some((f) => f.includes("xrk-app://stream/api/events.mux"))).toBe(
      true,
    );
  });

  it("opens host SSE on the stream origin so remote-events reach the shell", async () => {
    Object.defineProperty(globalThis, "location", {
      value: { origin: "xrk-app://app", protocol: "xrk-app:", hostname: "app" },
      configurable: true,
    });
    const client = new ProbeClient();
    let opened = false;
    const ac = new AbortController();
    const host = client.events.host({}, ac.signal, () => {
      opened = true;
    });
    const iter = host[Symbol.asyncIterator]();
    const first = iter.next();
    await Promise.race([first, new Promise((r) => setTimeout(r, 50))]);
    await vi.waitFor(() => {
      expect(opened).toBe(true);
    });
    expect(client.fetches.some((f) => f.includes("xrk-app://stream/api/events.host"))).toBe(
      true,
    );
    ac.abort();
  });
});
