/**
 * Serialized WebSocket text writes with send-callback backpressure.
 * Think / tool bursts must not fill the socket faster than TCP, or Ping
 * timers starve on the same event loop.
 *
 * Pending frames are capped by count and UTF-8 bytes. Over budget terminates
 * the peer so the client reconnects with an empty queue — unbounded promise
 * chains of JSON strings were a Host OOM path under reconnect storms.
 */

/** Soft ceiling on queued frames per socket (not yet acked by `send` cb). */
export const WS_SEND_QUEUE_MAX_FRAMES = 2_048;
/** Soft ceiling on queued UTF-8 bytes per socket. */
export const WS_SEND_QUEUE_MAX_BYTES = 32 * 1024 * 1024;

/** Minimal socket face used by the queue (real `ws` sockets satisfy this). */
export interface WsQueuedSocket {
  readonly readyState: number;
  readonly OPEN: number;
  send(data: string, cb?: (err?: Error) => void): void;
  terminate(): void;
}

export interface WsSendQueueOptions {
  readonly maxPendingFrames?: number;
  readonly maxPendingBytes?: number;
}

/**
 * Queue JSON frames onto one socket. Later frames wait until `send`'s
 * callback fires. A write error or queue-budget overflow terminates the peer
 * so the client reconnects.
 */
export function createWsSendQueue(
  socket: WsQueuedSocket,
  options?: WsSendQueueOptions,
): {
  sendJson(payload: unknown): void;
} {
  const maxFrames = options?.maxPendingFrames ?? WS_SEND_QUEUE_MAX_FRAMES;
  const maxBytes = options?.maxPendingBytes ?? WS_SEND_QUEUE_MAX_BYTES;
  let writes = Promise.resolve();
  let pendingFrames = 0;
  let pendingBytes = 0;
  let closed = false;

  const trip = (): void => {
    if (closed) return;
    closed = true;
    try {
      if (socket.readyState === socket.OPEN) socket.terminate();
    } catch {
      /* ignore */
    }
  };

  return {
    sendJson(payload) {
      if (closed || socket.readyState !== socket.OPEN) return;
      let text: string;
      try {
        text = JSON.stringify(payload);
      } catch {
        return;
      }
      const bytes = Buffer.byteLength(text, "utf8");
      if (pendingFrames + 1 > maxFrames || pendingBytes + bytes > maxBytes) {
        trip();
        return;
      }
      pendingFrames += 1;
      pendingBytes += bytes;
      writes = writes
        .then(
          () =>
            new Promise<void>((resolve) => {
              const release = (): void => {
                pendingFrames = Math.max(0, pendingFrames - 1);
                pendingBytes = Math.max(0, pendingBytes - bytes);
                resolve();
              };
              if (closed || socket.readyState !== socket.OPEN) {
                release();
                return;
              }
              socket.send(text, (error) => {
                if (error && socket.readyState === socket.OPEN) trip();
                release();
              });
            }),
        )
        .catch(() => undefined);
    },
  };
}
