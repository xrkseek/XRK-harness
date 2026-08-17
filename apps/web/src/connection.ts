/**
 * Face connection loop — patterns from DSH client/connection,
 * implemented against XRK Face (unary + mux/host WS).
 */

import { FaceClient } from "./face-client.js";

export type FaceConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

export interface FaceConnectionOptions {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly fetch?: typeof fetch;
  readonly onStatus?: (status: FaceConnectionStatus, detail?: string) => void;
  readonly onMux?: (frame: unknown) => void;
  readonly onHost?: (frame: unknown) => void;
}

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;

export class FaceConnection {
  private client: FaceClient;
  private mux: WebSocket | undefined;
  private host: WebSocket | undefined;
  private status: FaceConnectionStatus = "idle";
  private stopped = true;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly options: FaceConnectionOptions;

  constructor(options: FaceConnectionOptions) {
    this.options = options;
    this.client = new FaceClient({
      baseUrl: options.baseUrl,
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  get face(): FaceClient {
    return this.client;
  }

  get connectionStatus(): FaceConnectionStatus {
    return this.status;
  }

  /** Replace base URL / API key and reconnect if running. */
  reconfigure(patch: { baseUrl?: string; apiKey?: string }): void {
    const baseUrl = patch.baseUrl?.trim() || this.options.baseUrl;
    const apiKey =
      patch.apiKey !== undefined
        ? patch.apiKey.trim() || undefined
        : this.options.apiKey;
    this.client = new FaceClient({
      baseUrl,
      ...(apiKey ? { apiKey } : {}),
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });
    if (!this.stopped) {
      void this.start();
    }
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.clearReconnect();
    this.tearSockets();
    this.setStatus("connecting");
    try {
      const describe = await this.client.call<{
        version?: string;
        cwd?: string;
      }>("host.describe", {});
      if (!describe.ok) {
        this.setStatus(
          "failed",
          `${describe.error.code}: ${describe.error.message}`,
        );
        this.scheduleReconnect();
        return;
      }
      this.openSockets();
    } catch (err) {
      this.setStatus(
        "failed",
        err instanceof Error ? err.message : String(err),
      );
      this.scheduleReconnect();
    }
  }

  stop(): void {
    this.stopped = true;
    this.clearReconnect();
    this.tearSockets();
    this.setStatus("idle");
  }

  private openSockets(): void {
    let muxOpen = false;
    let hostOpen = false;
    const maybeConnected = (): void => {
      if (this.stopped) return;
      if (muxOpen && hostOpen) {
        this.attempt = 0;
        this.setStatus("connected");
      }
    };

    this.mux = this.client.openMux((frame) => {
      this.options.onMux?.(frame);
    });
    this.mux.addEventListener("open", () => {
      muxOpen = true;
      maybeConnected();
    });
    this.mux.addEventListener("close", () => {
      muxOpen = false;
      if (!this.stopped) this.onSocketLost();
    });
    this.mux.addEventListener("error", () => {
      /* close handler drives reconnect */
    });

    this.host = this.client.openHost((frame) => {
      this.options.onHost?.(frame);
    });
    this.host.addEventListener("open", () => {
      hostOpen = true;
      maybeConnected();
    });
    this.host.addEventListener("close", () => {
      hostOpen = false;
      if (!this.stopped) this.onSocketLost();
    });
  }

  private onSocketLost(): void {
    if (this.stopped) return;
    this.tearSockets();
    this.setStatus("reconnecting");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!;
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.stopped) void this.start();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private tearSockets(): void {
    try {
      this.mux?.close();
    } catch {
      /* ignore */
    }
    try {
      this.host?.close();
    } catch {
      /* ignore */
    }
    this.mux = undefined;
    this.host = undefined;
  }

  private setStatus(status: FaceConnectionStatus, detail?: string): void {
    this.status = status;
    this.options.onStatus?.(status, detail);
  }
}
