/** Browser Face client — DeepSeek-native `/api/<method>` paths + mux WS. */

export interface FaceClientOptions {
  readonly baseUrl: string;
  readonly apiKey?: string;
  fetch?: typeof fetch;
}

export type FaceRpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
    };

export type FaceCallOutcome<T> = FaceRpcResult<T> & { readonly rpcId: string };

export class FaceClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private seq = 0;

  constructor(options: FaceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  get httpBase(): string {
    return this.baseUrl;
  }

  get muxWsUrl(): string {
    const u = new URL(this.baseUrl);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = "/api/events.mux";
    u.search = "";
    u.hash = "";
    return u.toString();
  }

  async call<T>(
    method: string,
    payload: unknown = {},
  ): Promise<FaceCallOutcome<T>> {
    const rpcId = `web_${++this.seq}_${Date.now().toString(36)}`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }
    const res = await this.fetchImpl(`${this.baseUrl}/api/${method}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "client-request",
        rpcId,
        method,
        payload,
      }),
    });
    if (!res.ok) {
      return {
        ok: false,
        rpcId,
        error: { code: `http-${res.status}`, message: await res.text() },
      };
    }
    const body = (await res.json()) as {
      type?: string;
      rpcId?: string;
      result: FaceRpcResult<T>;
    };
    return { ...body.result, rpcId: body.rpcId ?? rpcId };
  }

  /**
   * Open mux WS. Prefer same-origin when API key is required (browsers
   * cannot set WS Authorization headers).
   */
  openMux(onFrame: (frame: unknown) => void): WebSocket {
    const ws = new WebSocket(this.muxWsUrl);
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          type?: string;
          payload?: unknown;
        };
        // DeepSeek wire: server-request { method, payload }; legacy: { payload }
        onFrame(msg.payload ?? msg);
      } catch {
        /* ignore malformed */
      }
    });
    return ws;
  }
}
