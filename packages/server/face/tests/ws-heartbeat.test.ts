import { once } from "node:events";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { startWsHeartbeat } from "../src/ws-heartbeat.js";

const running = new Set<{ http: ReturnType<typeof createServer>; wss: WebSocketServer }>();

afterEach(async () => {
  for (const entry of [...running]) {
    running.delete(entry);
    for (const client of entry.wss.clients) client.terminate();
    entry.wss.close();
    await new Promise<void>((resolve, reject) => {
      entry.http.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

async function listen(intervalMs = 20): Promise<{
  url: string;
  wss: WebSocketServer;
  heartbeat: ReturnType<typeof startWsHeartbeat>;
}> {
  const http = createServer();
  const wss = new WebSocketServer({ noServer: true });
  const heartbeat = startWsHeartbeat([wss], intervalMs);
  http.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      heartbeat.watch(ws);
      wss.emit("connection", ws, req);
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", () => {
      http.off("error", reject);
      resolve();
    });
  });
  const address = http.address();
  if (address === null || typeof address === "string") {
    throw new Error("fixture HTTP server has no TCP port");
  }
  running.add({ http, wss });
  return {
    url: `ws://127.0.0.1:${String(address.port)}`,
    wss,
    heartbeat,
  };
}

describe("Face WebSocket heartbeat", () => {
  it("exchanges Ping/Pong while the peer answers", async () => {
    const { url, wss, heartbeat } = await listen(30);
    const client = new WebSocket(url);
    await once(client, "open");
    const serverSocket = [...wss.clients][0]!;
    const ping = once(client, "ping");
    const pong = once(serverSocket, "pong");
    expect((await ping)[0]).toEqual(Buffer.alloc(0));
    expect((await pong)[0]).toEqual(Buffer.alloc(0));
    heartbeat.stop();
    client.close();
  });

  it("requires two missed heartbeats before terminating an unresponsive socket", async () => {
    const { url, wss, heartbeat } = await listen(20);
    const client = new WebSocket(url, { autoPong: false });
    await once(client, "open");
    const serverSocket = [...wss.clients][0]!;
    serverSocket.removeAllListeners("pong");
    const terminated = vi.spyOn(serverSocket, "terminate");
    await once(client, "ping");
    await once(client, "ping");
    expect(terminated).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(terminated).toHaveBeenCalledOnce();
    });
    heartbeat.stop();
    client.terminate();
  });

  it("keeps the socket when a delayed Pong arrives before the final check", async () => {
    const { url, wss, heartbeat } = await listen(20);
    const client = new WebSocket(url, { autoPong: false });
    await once(client, "open");
    const serverSocket = [...wss.clients][0]!;
    const terminated = vi.spyOn(serverSocket, "terminate");
    let finalCheck: (() => void) | undefined;
    const immediate = vi.spyOn(globalThis, "setImmediate").mockImplementation((callback) => {
      finalCheck = callback as () => void;
      return 0 as unknown as NodeJS.Immediate;
    });

    try {
      await once(client, "ping");
      await once(client, "ping");
      await vi.waitFor(() => {
        expect(finalCheck).toBeDefined();
      });
      serverSocket.emit("pong", Buffer.alloc(0));
      finalCheck?.();
      expect(terminated).not.toHaveBeenCalled();
    } finally {
      immediate.mockRestore();
      heartbeat.stop();
      const closed = once(client, "close");
      client.close();
      await closed;
    }
  });
});
