/**
 * Face mux/host WebSocket Ping cadence (aligned with DSH gateway heartbeats).
 * Idle intermediaries see protocol traffic without Face RPC frames; a socket
 * that misses consecutive Pongs is terminated.
 */
import WebSocket, { type WebSocketServer } from "ws";

/** Default interval between Ping control frames (ms). */
export const FACE_WS_HEARTBEAT_INTERVAL_MS = 2_000;

/** Missed Ping answers before the Host terminates the peer. */
const MAX_MISSED_HEARTBEATS = 2;

export interface WsHeartbeat {
  /** Arm Ping tracking for one accepted socket; starts the shared timer. */
  watch(ws: WebSocket): void;
  /** Clear the shared timer (call from Face upgrade close). */
  stop(): void;
}

/**
 * Shared Ping/Pong watchdog across one or more `noServer` WebSocketServers.
 * @param servers - Face mux and/or host acceptors.
 * @param intervalMs - Ping cadence and per-miss deadline (default 2s).
 */
export function startWsHeartbeat(
  servers: readonly WebSocketServer[],
  intervalMs: number = FACE_WS_HEARTBEAT_INTERVAL_MS,
): WsHeartbeat {
  const missedHeartbeats = new WeakMap<WebSocket, number>();
  let heartbeatTimer: NodeJS.Timeout | undefined;

  function ensureTimer(): void {
    if (heartbeatTimer !== undefined) return;
    heartbeatTimer = setInterval(() => {
      for (const wss of servers) {
        for (const socket of wss.clients) {
          if (socket.readyState !== WebSocket.OPEN) continue;
          const missed = missedHeartbeats.get(socket) ?? 0;
          if (missed >= MAX_MISSED_HEARTBEATS) {
            setImmediate(() => {
              if ((missedHeartbeats.get(socket) ?? 0) >= MAX_MISSED_HEARTBEATS) {
                socket.terminate();
              }
            });
            continue;
          }
          missedHeartbeats.set(socket, missed + 1);
          socket.ping();
        }
      }
    }, intervalMs);
    heartbeatTimer.unref();
  }

  return {
    watch(ws) {
      missedHeartbeats.set(ws, 0);
      ws.on("pong", () => {
        missedHeartbeats.set(ws, 0);
      });
      ensureTimer();
    },
    stop() {
      if (heartbeatTimer === undefined) return;
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    },
  };
}
