/**
 * Thin Face HTTP + mux client for `xrkh tui` (reuse Host Face; no browser DOM).
 * Loopback Hosts accept mux without an API key (same gate as the product shell).
 */

import { randomUUID } from "node:crypto";

export interface FaceClientOptions {
  readonly baseUrl: string;
  /** Optional `XRK_API_KEY` / Bearer (HTTP unary; mux relies on loopback gate). */
  readonly apiKey?: string;
  readonly fetchImpl?: typeof fetch;
}

export type FaceCallResult<T = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface MuxEnvelope {
  readonly type?: string;
  readonly rpcId?: string;
  readonly method?: string;
  readonly payload?: {
    readonly type?: string;
    readonly sessionId?: string;
    readonly event?: unknown;
    readonly seq?: number;
    readonly [key: string]: unknown;
  };
}

function headers(apiKey?: string): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (apiKey) {
    h.authorization = `Bearer ${apiKey}`;
    h["x-api-key"] = apiKey;
  }
  return h;
}

/** POST `/api/<method>` Face unary. */
export async function faceCall<T = unknown>(
  options: FaceClientOptions,
  method: string,
  payload: Record<string, unknown>,
): Promise<FaceCallResult<T>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rpcId = randomUUID();
  const url = `${options.baseUrl.replace(/\/+$/, "")}/api/${method}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: headers(options.apiKey),
      body: JSON.stringify({
        type: "client-request",
        rpcId,
        payload,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      code: "host-unreachable",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  const body = (await res.json().catch(() => null)) as {
    result?: {
      ok?: boolean;
      value?: T;
      error?: { code?: string; message?: string };
    };
  } | null;
  if (!res.ok) {
    return {
      ok: false,
      code: `http-${res.status}`,
      message: `Face ${method} HTTP ${res.status}`,
    };
  }
  const result = body?.result;
  if (!result || result.ok !== true) {
    return {
      ok: false,
      code: result?.error?.code ?? "face-error",
      message: result?.error?.message ?? `Face ${method} failed`,
    };
  }
  return { ok: true, value: result.value as T };
}

export interface MuxSubscription {
  readonly close: () => void;
  /** Resolves when the socket is open (or rejects on early error). */
  readonly ready: Promise<void>;
}

/**
 * Subscribe to `/api/events.mux` (Node global WebSocket).
 * Frames arrive as `{ type, rpcId, payload }` (server-request).
 */
export function openFaceMux(
  options: FaceClientOptions,
  onFrame: (env: MuxEnvelope) => void,
  onError?: (err: Error) => void,
): MuxSubscription {
  const base = options.baseUrl.replace(/\/+$/, "").replace(/^http/, "ws");
  const url = `${base}/api/events.mux`;
  const ws = new WebSocket(url);

  let opened = false;
  let settleReady: (() => void) | undefined;
  let rejectReady: ((err: Error) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    settleReady = resolve;
    rejectReady = reject;
  });

  ws.addEventListener("open", () => {
    opened = true;
    settleReady?.();
  });
  ws.addEventListener("message", (ev) => {
    try {
      const data =
        typeof ev.data === "string"
          ? ev.data
          : Buffer.from(ev.data as ArrayBuffer).toString("utf8");
      const env = JSON.parse(data) as MuxEnvelope;
      onFrame(env);
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  });
  ws.addEventListener("error", () => {
    const err = new Error("mux websocket error");
    if (!opened) rejectReady?.(err);
    onError?.(err);
  });
  ws.addEventListener("close", () => {
    if (!opened) rejectReady?.(new Error("mux websocket closed before open"));
  });

  return {
    ready,
    close() {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

export function resolveFaceBaseUrl(host?: string, port?: number): string {
  const h = (host ?? "127.0.0.1").trim() || "127.0.0.1";
  const p = port ?? 8787;
  return `http://${h}:${p}`;
}

export function resolveFaceApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = env.XRK_API_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
}
