/**
 * Generic IM vendor WebSocket client (ADR-0006). Connects to gateway WS and relays inbound events.
 */
import { ingestImWebhook } from "./im-messaging-bridge.js";
import { readImGatewaySidecarConfig } from "./im-gateway-sidecar.js";

export const IM_GATEWAY_WS_ENV_URL = "XRK_IM_GATEWAY_WS_URL";

export interface ImVendorWsClientState {
  readonly configured: boolean;
  readonly connected: boolean;
  readonly url?: string;
  readonly reconnects: number;
  readonly lastError?: string;
}

type WsLike = {
  close: () => void;
  addEventListener: (type: string, listener: (...args: unknown[]) => void) => void;
  send: (data: string) => void;
  readyState: number;
};

const WS_OPEN = 1;

let activeSocket: WsLike | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let clientState: ImVendorWsClientState = {
  configured: false,
  connected: false,
  reconnects: 0,
};

let runtime: {
  xrkHome?: string;
  env: NodeJS.ProcessEnv;
} = { env: process.env };

export function readImVendorWsUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const explicit = env[IM_GATEWAY_WS_ENV_URL]?.trim();
  if (explicit) return explicit;
  const sidecar = readImGatewaySidecarConfig(env)?.url;
  if (!sidecar) return undefined;
  const wsBase = sidecar.replace(/^http/i, "ws").replace(/\/+$/, "");
  return `${wsBase}/ws`;
}

export function getImVendorWsClientState(): ImVendorWsClientState {
  return clientState;
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  const delayMs = Math.min(30_000, 1000 * (clientState.reconnects + 1));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startImVendorWsClient(runtime);
  }, delayMs);
}

function handleWsMessage(raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object") return;
  const channel = String(
    (parsed as { channel?: unknown }).channel ??
      (parsed as { vendor?: unknown }).vendor ??
      "",
  ).trim();
  if (!channel) return;
  const botId =
    typeof (parsed as { botId?: unknown }).botId === "string"
      ? (parsed as { botId: string }).botId
      : undefined;
  ingestImWebhook(runtime.xrkHome, channel, parsed as Record<string, unknown>, botId);
}

function attachSocket(ws: WsLike, url: string): void {
  activeSocket = ws;
  clientState = {
    ...clientState,
    configured: true,
    connected: false,
    url,
  };
  ws.addEventListener("open", () => {
    clientState = { ...clientState, connected: true };
  });
  ws.addEventListener("message", (event: unknown) => {
    const data =
      event &&
      typeof event === "object" &&
      typeof (event as { data?: unknown }).data === "string"
        ? (event as { data: string }).data
        : typeof event === "string"
          ? event
          : "";
    if (data) handleWsMessage(data);
  });
  ws.addEventListener("close", () => {
    activeSocket = null;
    clientState = {
      ...clientState,
      connected: false,
      reconnects: clientState.reconnects + 1,
    };
    scheduleReconnect();
  });
  ws.addEventListener("error", () => {
    clientState = {
      ...clientState,
      connected: false,
      lastError: "websocket-error",
    };
  });
}

export function startImVendorWsClient(options: {
  readonly xrkHome?: string;
  readonly env?: NodeJS.ProcessEnv;
} = {}): ImVendorWsClientState {
  runtime = {
    ...(options.xrkHome ? { xrkHome: options.xrkHome } : {}),
    env: options.env ?? process.env,
  };
  const url = readImVendorWsUrl(runtime.env);
  if (!url) {
    clientState = { configured: false, connected: false, reconnects: 0 };
    return clientState;
  }
  if (activeSocket && activeSocket.readyState === WS_OPEN) {
    return { ...clientState, configured: true, url };
  }
  stopImVendorWsClient(false);
  try {
    const WebSocketCtor = (globalThis as { WebSocket?: new (url: string, protocols?: string | string[]) => WsLike }).WebSocket;
    if (!WebSocketCtor) {
      clientState = {
        configured: true,
        connected: false,
        url,
        reconnects: clientState.reconnects,
        lastError: "WebSocket unavailable",
      };
      return clientState;
    }
    const token = runtime.env.XRK_IM_GATEWAY_TOKEN?.trim();
    const wsUrl = token
      ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
      : url;
    attachSocket(new WebSocketCtor(wsUrl), url);
    return { ...clientState, configured: true, url };
  } catch (err) {
    clientState = {
      configured: true,
      connected: false,
      url,
      reconnects: clientState.reconnects,
      lastError: err instanceof Error ? err.message : String(err),
    };
    scheduleReconnect();
    return clientState;
  }
}

export function stopImVendorWsClient(clearReconnect = true): void {
  if (reconnectTimer && clearReconnect) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (activeSocket) {
    try {
      activeSocket.close();
    } catch {
      /* ignore */
    }
    activeSocket = null;
  }
  clientState = { ...clientState, connected: false };
}
