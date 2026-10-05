/**
 * Serialized WebSocket text writes with send-callback backpressure.
 * Caps pending frames / bytes; over budget drops the new frame (peer stays
 * up). Write failure closes the queue. Mirrors DSH “release window” pacing
 * without per-byte window counters — see docs/host-face.md.
 *
 * Frames that carry a `sessionId` (top-level or `payload.sessionId` on the
 * `server-request` envelope) sit in per-session lanes and drain round-robin
 * so one session's burst cannot stall every other live stream on the socket.
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

const SHARED_LANE = "";

/**
 * Lane key for fair mux/host writes. Session-scoped frames isolate; host-wide
 * frames (no sessionId) share one lane and still participate in round-robin.
 */
export function muxSendLaneKey(payload: unknown): string {
  if (!payload || typeof payload !== "object") return SHARED_LANE;
  const rec = payload as Record<string, unknown>;
  if (typeof rec.sessionId === "string" && rec.sessionId.length > 0) {
    return rec.sessionId;
  }
  const inner = rec.payload;
  if (inner && typeof inner === "object") {
    const nested = inner as Record<string, unknown>;
    if (typeof nested.sessionId === "string" && nested.sessionId.length > 0) {
      return nested.sessionId;
    }
  }
  return SHARED_LANE;
}

type QueuedFrame = { readonly text: string; readonly bytes: number };

/**
 * Queue JSON frames onto one socket. Later frames wait until `send`'s
 * callback fires. Over-budget frames are dropped; write errors stop enqueue.
 * Session lanes interleave; order within a lane is FIFO.
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
  const lanes = new Map<string, QueuedFrame[]>();
  const order: string[] = [];
  let cursor = 0;

  const enqueueLane = (lane: string, frame: QueuedFrame): void => {
    let q = lanes.get(lane);
    if (!q) {
      q = [];
      lanes.set(lane, q);
      order.push(lane);
    }
    q.push(frame);
  };

  const takeNext = (): QueuedFrame | undefined => {
    const n = order.length;
    if (n === 0) return undefined;
    for (let i = 0; i < n; i += 1) {
      const idx = (cursor + i) % n;
      const key = order[idx];
      if (key === undefined) continue;
      const q = lanes.get(key);
      if (!q || q.length === 0) continue;
      const item = q.shift();
      if (q.length === 0) {
        lanes.delete(key);
        order.splice(idx, 1);
        cursor = order.length === 0 ? 0 : idx % order.length;
      } else {
        cursor = (idx + 1) % order.length;
      }
      return item;
    }
    return undefined;
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
      enqueueLane(muxSendLaneKey(payload), { text, bytes });
      writes = writes
        .then(
          () =>
            new Promise<void>((resolve) => {
              const item = takeNext();
              const release = (): void => {
                pendingFrames = Math.max(0, pendingFrames - 1);
                pendingBytes = Math.max(0, pendingBytes - (item?.bytes ?? bytes));
                resolve();
              };
              if (!item || closed || socket.readyState !== socket.OPEN) {
                release();
                return;
              }
              socket.send(item.text, (error) => {
                if (error) closed = true;
                release();
              });
            }),
        )
        .catch(() => undefined);
    },
  };
}
