import { describe, expect, it, vi } from "vitest";
import {
  createWsSendQueue,
  muxSendLaneKey,
  type WsQueuedSocket,
} from "../src/ws-send-queue.js";

class FakeSocket implements WsQueuedSocket {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: string[] = [];
  private pending: Array<(err?: Error) => void> = [];

  send(data: string, cb?: (err?: Error) => void): void {
    this.sent.push(data);
    if (cb) this.pending.push(cb);
    else this.pending.push(() => {});
  }

  ack(error?: Error): void {
    const cb = this.pending.shift();
    cb?.(error);
  }
}

describe("createWsSendQueue", () => {
  it("holds the next frame until the previous send callback fires", async () => {
    const socket = new FakeSocket();
    const queue = createWsSendQueue(socket);
    queue.sendJson({ n: 1 });
    queue.sendJson({ n: 2 });
    await Promise.resolve();
    expect(socket.sent).toEqual(['{"n":1}']);
    socket.ack();
    await vi.waitFor(() => {
      expect(socket.sent).toEqual(['{"n":1}', '{"n":2}']);
    });
  });

  it("skips writes after the socket is no longer OPEN", async () => {
    const socket = new FakeSocket();
    const queue = createWsSendQueue(socket);
    queue.sendJson({ n: 1 });
    await Promise.resolve();
    socket.readyState = 3;
    socket.ack();
    queue.sendJson({ n: 2 });
    await vi.waitFor(() => {
      expect(socket.sent).toEqual(['{"n":1}']);
    });
  });

  it("stops enqueueing after a write fails without closing the peer", async () => {
    const socket = new FakeSocket();
    const queue = createWsSendQueue(socket);
    queue.sendJson({ n: 1 });
    await Promise.resolve();
    socket.ack(new Error("write failed"));
    await Promise.resolve();
    queue.sendJson({ n: 2 });
    await Promise.resolve();
    expect(socket.readyState).toBe(socket.OPEN);
    expect(socket.sent).toEqual(['{"n":1}']);
  });

  it("drops frames over the pending count budget", async () => {
    const socket = new FakeSocket();
    const queue = createWsSendQueue(socket, { maxPendingFrames: 2, maxPendingBytes: 1_000_000 });
    queue.sendJson({ n: 1 });
    queue.sendJson({ n: 2 });
    queue.sendJson({ n: 3 });
    expect(socket.readyState).toBe(socket.OPEN);
    await Promise.resolve();
    expect(socket.sent).toEqual(['{"n":1}']);
  });

  it("drops frames over the pending UTF-8 byte budget", async () => {
    const socket = new FakeSocket();
    const queue = createWsSendQueue(socket, {
      maxPendingFrames: 100,
      maxPendingBytes: 40,
    });
    queue.sendJson({ pad: "xxxxxxxxxxxxxxxxxxxx" });
    queue.sendJson({ pad: "yyyyyyyyyyyyyyyyyyyy" });
    expect(socket.readyState).toBe(socket.OPEN);
    await Promise.resolve();
    expect(socket.sent).toHaveLength(1);
  });

  it("round-robins frames from different session lanes", async () => {
    const socket = new FakeSocket();
    const queue = createWsSendQueue(socket);
    queue.sendJson({ type: "session/event", sessionId: "a", n: 1 });
    queue.sendJson({ type: "session/event", sessionId: "a", n: 2 });
    queue.sendJson({ type: "session/event", sessionId: "b", n: 1 });
    await Promise.resolve();
    expect(socket.sent).toEqual([
      '{"type":"session/event","sessionId":"a","n":1}',
    ]);
    socket.ack();
    await vi.waitFor(() => {
      expect(socket.sent).toHaveLength(2);
    });
    expect(socket.sent[1]).toBe(
      '{"type":"session/event","sessionId":"b","n":1}',
    );
    socket.ack();
    await vi.waitFor(() => {
      expect(socket.sent).toHaveLength(3);
    });
    expect(socket.sent[2]).toBe(
      '{"type":"session/event","sessionId":"a","n":2}',
    );
  });

  it("uses nested payload.sessionId on server-request envelopes", () => {
    expect(
      muxSendLaneKey({
        type: "server-request",
        payload: { type: "session/event", sessionId: "sess_x" },
      }),
    ).toBe("sess_x");
  });

  it("drops a single oversize frame", async () => {
    const socket = new FakeSocket();
    const queue = createWsSendQueue(socket, {
      maxPendingFrames: 100,
      maxPendingBytes: 20,
    });
    queue.sendJson({ pad: "xxxxxxxxxxxxxxxxxxxx" });
    expect(socket.readyState).toBe(socket.OPEN);
    await Promise.resolve();
    expect(socket.sent).toEqual([]);
  });
});
