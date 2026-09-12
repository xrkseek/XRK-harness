/**
 * Serialized WebSocket text writes with send-callback backpressure.
 * Think / tool bursts must not fill the socket faster than TCP, or Ping
 * timers starve on the same event loop.
 */
import type { WebSocket } from "ws";

/** Minimal socket face used by the queue (real `ws` sockets satisfy this). */
export interface WsQueuedSocket {
  readonly readyState: number;
  readonly OPEN: number;
  send(data: string, cb?: (err?: Error) => void): void;
  terminate(): void;
}

/**
 * Queue JSON frames onto one socket. Later frames wait until `send`'s
 * callback fires. A write error terminates the peer so the client reconnects.
 */
export function createWsSendQueue(socket: WsQueuedSocket): {
  sendJson(payload: unknown): void;
} {
  let writes = Promise.resolve();
  return {
    sendJson(payload) {
      let text: string;
      try {
        text = JSON.stringify(payload);
      } catch {
        return;
      }
      writes = writes
        .then(
          () =>
            new Promise<void>((resolve) => {
              if (socket.readyState !== socket.OPEN) {
                resolve();
                return;
              }
              socket.send(text, (error) => {
                if (error && socket.readyState === socket.OPEN) {
                  socket.terminate();
                }
                resolve();
              });
            }),
        )
        .catch(() => undefined);
    },
  };
}

/** Bind a live `ws` socket to {@link createWsSendQueue}. */
export function createFaceSocketSendQueue(socket: WebSocket): {
  sendJson(payload: unknown): void;
} {
  return createWsSendQueue(socket);
}
