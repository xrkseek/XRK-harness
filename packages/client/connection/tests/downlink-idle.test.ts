/**
 * WebApiClient downlink idle watchdog: a stream whose body goes permanently
 * quiet (half-open socket, wedged proxy) must fail instead of hanging, so the
 * connection layer can rebuild its generation. The server speaks every 15s
 * (`: keepalive`), so silence past three missed heartbeats is a dead channel.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { WebApiClient } from "../src/client/web-api-client.ts";

/**
 * Stalled-then-chatty body: writes land before the generator reaches its fetch
 * leg (frames are buffered), so a test controls the byte cadence without having
 * to synchronize on `onOpen` first.
 */
class ControllableStreamClient extends WebApiClient {
  private controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readonly queued: string[] = [];

  protected override doFetch(_input: URL, _init?: RequestInit): Promise<Response> {
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controllerRef = controller;
        controller.enqueue(new TextEncoder().encode(": connected\n\n"));
        for (const text of this.queued.splice(0)) {
          controller.enqueue(new TextEncoder().encode(text));
        }
      },
    });
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
  }

  /** @returns whether the body was already open and took the keepalive byte. */
  pushKeepalive(): boolean {
    if (this.controllerRef === null) {
      this.queued.push(": keepalive\n\n");
      return false;
    }
    this.controllerRef.enqueue(new TextEncoder().encode(": keepalive\n\n"));
    return true;
  }

  /** @param json - one server-request envelope to deliver. */
  pushFrame(json: string): void {
    const text = `data: ${json}\n\n`;
    if (this.controllerRef === null) {
      this.queued.push(text);
      return;
    }
    this.controllerRef.enqueue(new TextEncoder().encode(text));
  }
}

describe("WebApiClient downlink idle watchdog", () => {
  const previousLocation = globalThis.location;

  /**
   * Desktop `xrk-app://` origin — the SSE downlink path under test (a plain
   * `http:` origin takes the WebSocket branch instead).
   * @param hostname - the app hostname.
   */
  function atDesktopOrigin(hostname = "app"): void {
    Object.defineProperty(globalThis, "location", {
      value: { origin: `xrk-app://${hostname}`, protocol: "xrk-app:", hostname },
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(globalThis, "location", {
      value: previousLocation,
      configurable: true,
    });
    vi.useRealTimers();
  });

  it("fails a stream whose body stops producing bytes, keepalives included", async () => {
    atDesktopOrigin();
    // Fake timers: the deadline is 45s of real silence, far past a test budget.
    vi.useFakeTimers();
    const client = new ControllableStreamClient();
    const ac = new AbortController();
    let opened = false;
    const iter = client.events.host({}, ac.signal, () => {
      opened = true;
    })[Symbol.asyncIterator]();
    const pending = iter.next();
    // Attach the rejection handler BEFORE advancing the clock: the deadline
    // rejects while the timers run, and a handler attached afterwards would
    // leave that rejection briefly unobserved.
    const failure = expect(pending).rejects.toThrow(/downlink idle/);
    await vi.advanceTimersByTimeAsync(0);
    expect(opened).toBe(true);

    await vi.advanceTimersByTimeAsync(46_000);
    await failure;
    ac.abort();
  });

  it("keeps a stream that keeps talking past the deadline", async () => {
    atDesktopOrigin();
    vi.useFakeTimers();
    const client = new ControllableStreamClient();
    const ac = new AbortController();
    const iter = client.events.host({}, ac.signal)[Symbol.asyncIterator]();
    const pending = iter.next();
    let settled = false;
    void pending.then(
      () => { settled = true; },
      () => { settled = true; },
    );

    // Five minutes of `: keepalive` comments: past the deadline many times over,
    // still no frame — the read must stay pending, not reject.
    for (let tick = 0; tick < 10; tick++) {
      await vi.advanceTimersByTimeAsync(15_000);
      expect(client.pushKeepalive()).toBe(true);
    }
    expect(settled).toBe(false);
    ac.abort();
  });

  it("yields frames normally once the body speaks", async () => {
    atDesktopOrigin();
    // Fake timers here too: the frame leg must not wait on the real 45s
    // deadline to prove the reader is actually reading.
    vi.useFakeTimers();
    const client = new ControllableStreamClient();
    const ac = new AbortController();
    const iter = client.events.host({}, ac.signal)[Symbol.asyncIterator]();
    const pending = iter.next();
    await vi.advanceTimersByTimeAsync(0);
    client.pushFrame(
      JSON.stringify({
        type: "server-request",
        rpcId: "r1",
        method: "events.host",
        payload: { type: "host/session-status", sessionId: "s1", running: true },
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    const next = await pending;
    expect(next.value?.payload).toEqual({
      type: "host/session-status",
      sessionId: "s1",
      running: true,
    });
    ac.abort();
  });
});