/**
 * Serialized WebSocket text writes with send-callback backpressure.
 * Caps pending frames / bytes; over budget drops the new frame (peer stays
 * up). Write failure closes the queue. Mirrors DSH “release window” pacing
 * without per-byte window counters — see docs/host-face.md.
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
}

export interface WsSendQueueOptions {
  readonly maxPendingFrames?: number;
  readonly maxPendingBytes?: number;
}

/**
 * Queue JSON frames onto one socket. Later frames wait until `send`'s
 * callback fires. Over-budget frames are dropped; write errors stop enqueue.
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
  let dropWarned = false;

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
      if (bytes > maxBytes || pendingFrames + 1 > maxFrames || pendingBytes + bytes > maxBytes) {
        if (!dropWarned) {
          dropWarned = true;
          console.warn(
            "[face] mux/host send queue over budget — dropping frame(s); peer stays up",
          );
        }
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
                if (error) closed = true;
                release();
              });
            }),
        )
        .catch(() => undefined);
    },
  };
}
