import { describe, expect, it, vi } from "vitest";
import { createWsSendQueue, type WsQueuedSocket } from "../src/ws-send-queue.js";

class FakeSocket implements WsQueuedSocket {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: string[] = [];
  terminateCount = 0;
  private pending: Array<(err?: Error) => void> = [];

  send(data: string, cb?: (err?: Error) => void): void {
    this.sent.push(data);
    if (cb) this.pending.push(cb);
    else this.pending.push(() => {});
  }

  terminate(): void {
    this.terminateCount += 1;
    this.readyState = 3;
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

  it("terminates the peer when a write fails while still OPEN", async () => {
    const socket = new FakeSocket();
    const queue = createWsSendQueue(socket);
    queue.sendJson({ n: 1 });
    await Promise.resolve();
    socket.ack(new Error("write failed"));
    await vi.waitFor(() => {
      expect(socket.terminateCount).toBe(1);
    });
  });

  it("terminates when pending frame count exceeds the budget", async () => {
    const socket = new FakeSocket();
    const queue = createWsSendQueue(socket, { maxPendingFrames: 2, maxPendingBytes: 1_000_000 });
    queue.sendJson({ n: 1 });
    queue.sendJson({ n: 2 });
    expect(socket.terminateCount).toBe(0);
    queue.sendJson({ n: 3 });
    expect(socket.terminateCount).toBe(1);
    expect(socket.readyState).not.toBe(socket.OPEN);
  });

  it("terminates when pending UTF-8 bytes exceed the budget", () => {
    const socket = new FakeSocket();
    const queue = createWsSendQueue(socket, {
      maxPendingFrames: 100,
      maxPendingBytes: 40,
    });
    queue.sendJson({ pad: "xxxxxxxxxxxxxxxxxxxx" });
    expect(socket.terminateCount).toBe(0);
    queue.sendJson({ pad: "yyyyyyyyyyyyyyyyyyyy" });
    expect(socket.terminateCount).toBe(1);
  });
});
