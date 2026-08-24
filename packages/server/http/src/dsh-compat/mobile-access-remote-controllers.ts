/**
 * Tailscale Funnel sidecar + cpolar process controllers (dsh-mobile compatible).
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import {
  type LocalMobileGateway,
  reserveLoopbackPort,
  startLocalProxyGateway,
} from "./mobile-access-local-gateway.js";

const MAX_LOG_BUFFER = 65536;
const MAX_PROTOCOL_LINE = 8192;
const START_TIMEOUT_MS = 45_000;

const CPOLAR_HOST_SUFFIXES = [
  ".cpolar.cn",
  ".cpolar.io",
  ".cpolar.top",
  ".cpolar.com",
];

export interface RemoteControllerStatus {
  enabled: boolean;
  state: string;
  origin?: string;
  loginUrl?: string;
  setupUrl?: string;
  errorCode?: string;
}

type CreateGatewayFn = (
  publicOrigin: string,
  listenPort?: number,
) => Promise<LocalMobileGateway>;

function publicStatus(status: RemoteControllerStatus): RemoteControllerStatus {
  return {
    enabled: status.enabled,
    state: status.state,
    ...(status.origin ? { origin: status.origin } : {}),
    ...(status.loginUrl ? { loginUrl: status.loginUrl } : {}),
    ...(status.setupUrl ? { setupUrl: status.setupUrl } : {}),
    ...(status.errorCode ? { errorCode: status.errorCode } : {}),
  };
}

function parseCpolarOrigin(line: string): string | undefined {
  if (!line.includes("Tunnel established at ")) return undefined;
  const match = /Tunnel established at (https:\/\/[^"\s]+)/u.exec(line);
  if (!match?.[1]) return undefined;
  const url = new URL(match[1]);
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    !CPOLAR_HOST_SUFFIXES.some((s) => url.hostname.endsWith(s)) ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("invalid_cpolar_origin");
  }
  return url.origin;
}

function parseFunnelOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".ts.net") ||
    url.port !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("invalid_funnel_origin");
  }
  return url.origin;
}

function parseFunnelEvent(line: string): {
  type: string;
  origin?: string;
  url?: string;
  code?: string;
} {
  if (Buffer.byteLength(line, "utf8") > MAX_PROTOCOL_LINE) {
    throw new Error("invalid_sidecar_protocol");
  }
  const value = JSON.parse(line) as Record<string, unknown>;
  if (value.version !== 1 || typeof value.type !== "string") {
    throw new Error("invalid_sidecar_protocol");
  }
  if (value.type === "login") {
    const url = new URL(String(value.url));
    if (url.protocol !== "https:" || url.hostname !== "login.tailscale.com") {
      throw new Error("invalid_sidecar_protocol");
    }
    return { type: "login", url: url.toString() };
  }
  if (value.type === "ready" || value.type === "serving") {
    return {
      type: value.type,
      origin: parseFunnelOrigin(String(value.origin)),
    };
  }
  if (value.type === "error") {
    return {
      type: "error",
      code: String(value.code ?? "funnel_failed"),
      ...(typeof value.url === "string" ? { url: value.url } : {}),
    };
  }
  throw new Error("invalid_sidecar_protocol");
}

function withoutProxyEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const blocked = new Set([
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
  ]);
  return Object.fromEntries(
    Object.entries(env).filter(([k]) => !blocked.has(k.toUpperCase())),
  );
}

function withoutTailscaleSecrets(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const blocked = new Set([
    "TS_AUTHKEY",
    "TAILSCALE_AUTHKEY",
    "TS_OAUTH_CLIENT_SECRET",
  ]);
  return Object.fromEntries(
    Object.entries(env).filter(([k]) => !blocked.has(k.toUpperCase())),
  );
}

abstract class BaseRemoteController {
  enabled = false;
  initialized = false;
  disposed = false;
  protected child: ChildProcessWithoutNullStreams | undefined;
  gatewayValue: LocalMobileGateway | undefined;
  protected generation = 0;
  protected buffer = "";
  protected latest: RemoteControllerStatus = { enabled: false, state: "off" };
  private queue: Promise<void> = Promise.resolve();
  protected startupTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly createGateway: CreateGatewayFn,
    readonly loadEnabled: () => Promise<boolean>,
    readonly saveEnabled: (enabled: boolean) => Promise<void>,
  ) {}

  async initialize(): Promise<void> {
    this.enabled = await this.loadEnabled();
    this.initialized = true;
    if (this.enabled) await this.start();
    else this.publish({ enabled: false, state: "off" });
  }

  gateway(): LocalMobileGateway | undefined {
    return this.gatewayValue;
  }

  status(): RemoteControllerStatus {
    return publicStatus(this.latest);
  }

  async setEnabled(enabled: boolean): Promise<RemoteControllerStatus> {
    if (!this.initialized || this.disposed) {
      throw new Error("remote controller unavailable");
    }
    await this.enqueue(async () => {
      if (this.enabled === enabled && (!enabled || this.child)) return;
      if (!enabled) await this.stop();
      this.enabled = enabled;
      await this.saveEnabled(enabled);
      if (enabled) await this.start();
      else this.publish({ enabled: false, state: "off" });
    });
    return this.status();
  }

  async reconnect(): Promise<RemoteControllerStatus> {
    await this.enqueue(async () => {
      if (!this.enabled) {
        this.enabled = true;
        await this.saveEnabled(true);
      }
      await this.stop();
      await this.start();
    });
    return this.status();
  }

  async reset(): Promise<RemoteControllerStatus> {
    await this.enqueue(async () => {
      await this.stop();
      this.enabled = false;
      await this.saveEnabled(false);
      this.publish({ enabled: false, state: "off" });
    });
    return this.status();
  }

  async close(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.enqueue(() => this.stop());
  }

  protected enqueue<T>(op: () => Promise<T>): Promise<T> {
    const task = this.queue.then(op, op);
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  protected publish(status: RemoteControllerStatus): void {
    this.latest = publicStatus(status);
  }

  protected async failGeneration(
    generation: number,
    code: string,
  ): Promise<void> {
    if (generation !== this.generation) return;
    await this.stop();
    if (this.enabled) {
      this.publish({ enabled: true, state: "error", errorCode: code });
    }
  }

  protected async stop(): Promise<void> {
    this.generation += 1;
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = undefined;
    const child = this.child;
    this.child = undefined;
    if (child && !child.killed) {
      child.kill();
    }
    if (this.gatewayValue) {
      await this.gatewayValue.close();
      this.gatewayValue = undefined;
    }
    this.buffer = "";
  }

  protected abstract start(): Promise<void>;
}

export class CpolarRemoteController extends BaseRemoteController {
  reservation: { port: number; release: () => Promise<void> } | undefined;

  constructor(
    createGateway: CreateGatewayFn,
    loadEnabled: () => Promise<boolean>,
    saveEnabled: (enabled: boolean) => Promise<void>,
    readonly executable: string,
    readonly configFile: string,
    readonly region = "cn",
  ) {
    super(createGateway, loadEnabled, saveEnabled);
  }

  protected async start(): Promise<void> {
    const generation = ++this.generation;
    const { stat } = await import("node:fs/promises");
    try {
      const est = await stat(this.executable);
      if (!est.isFile()) throw new Error("missing");
    } catch {
      this.publish({
        enabled: true,
        state: "unavailable",
        errorCode: "cpolar_component_missing",
      });
      return;
    }
    try {
      const cfg = await stat(this.configFile);
      if (!cfg.isFile()) throw new Error("missing");
    } catch {
      this.publish({
        enabled: true,
        state: "unavailable",
        errorCode: "cpolar_config_missing",
      });
      return;
    }
    let reservation;
    try {
      reservation = await reserveLoopbackPort();
    } catch {
      this.publish({
        enabled: true,
        state: "error",
        errorCode: "cpolar_port_unavailable",
      });
      return;
    }
    this.reservation = reservation;
    this.buffer = "";
    this.publish({ enabled: true, state: "starting" });
    const args = [
      "http",
      `-config=${path.resolve(this.configFile)}`,
      `-region=${this.region}`,
      "-inspect-addr=false",
      "-redirect-https=true",
      "-log=stdout",
      "-log-level=INFO",
      String(reservation.port),
    ];
    const child = spawn(this.executable, args, {
      env: withoutProxyEnv(process.env),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.consume(generation, String(chunk)));
    child.stderr.on("data", (chunk) => this.consume(generation, String(chunk)));
    child.once("error", () => {
      void this.enqueue(() => this.failGeneration(generation, "cpolar_launch_failed"));
    });
    child.once("close", (code) => {
      if (generation !== this.generation || this.child !== child) return;
      this.child = undefined;
      if (this.enabled) {
        void this.enqueue(() =>
          this.failGeneration(
            generation,
            code === 0 ? "cpolar_stopped" : "cpolar_exited",
          ),
        );
      }
    });
    this.startupTimer = setTimeout(() => {
      void this.enqueue(() => this.failGeneration(generation, "cpolar_start_timeout"));
    }, START_TIMEOUT_MS);
    this.startupTimer.unref();
  }

  private consume(generation: number, chunk: string): void {
    if (generation !== this.generation) return;
    this.buffer += chunk;
    if (
      Buffer.byteLength(this.buffer, "utf8") > MAX_LOG_BUFFER &&
      !this.buffer.includes("\n")
    ) {
      void this.enqueue(() =>
        this.failGeneration(generation, "cpolar_invalid_output"),
      );
      return;
    }
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).replace(/\r$/u, "");
      this.buffer = this.buffer.slice(newline + 1);
      try {
        const origin = parseCpolarOrigin(line);
        if (origin) {
          void this.enqueue(() => this.attachGateway(generation, origin));
        }
      } catch {
        void this.enqueue(() =>
          this.failGeneration(generation, "cpolar_invalid_origin"),
        );
        return;
      }
    }
  }

  private async attachGateway(
    generation: number,
    origin: string,
  ): Promise<void> {
    if (
      generation !== this.generation ||
      !this.enabled ||
      this.gatewayValue
    ) {
      return;
    }
    const reservation = this.reservation;
    if (!reservation) return;
    this.publish({ enabled: true, state: "connecting", origin });
    await reservation.release();
    if (this.reservation === reservation) this.reservation = undefined;
    let gateway;
    try {
      gateway = await this.createGateway(origin, reservation.port);
    } catch {
      await this.failGeneration(generation, "gateway_start_failed");
      return;
    }
    if (generation !== this.generation || !this.enabled) {
      await gateway.close();
      return;
    }
    this.gatewayValue = gateway;
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = undefined;
    this.publish({ enabled: true, state: "ready", origin });
  }

  protected override async stop(): Promise<void> {
    const reservation = this.reservation;
    this.reservation = undefined;
    if (reservation) await reservation.release();
    await super.stop();
  }
}

export class FunnelRemoteController extends BaseRemoteController {
  constructor(
    createGateway: CreateGatewayFn,
    loadEnabled: () => Promise<boolean>,
    saveEnabled: (enabled: boolean) => Promise<void>,
    readonly executable: string,
    readonly stateDirectory: string,
    readonly hostname: string,
  ) {
    super(createGateway, loadEnabled, saveEnabled);
  }

  protected async start(): Promise<void> {
    const generation = ++this.generation;
    const { stat } = await import("node:fs/promises");
    try {
      const est = await stat(this.executable);
      if (!est.isFile()) throw new Error("missing");
    } catch {
      this.publish({
        enabled: true,
        state: "unavailable",
        errorCode: "component_missing",
      });
      return;
    }
    this.buffer = "";
    this.publish({ enabled: true, state: "starting" });
    const child = spawn(
      this.executable,
      [
        "--state-dir",
        path.resolve(this.stateDirectory),
        "--hostname",
        this.hostname,
      ],
      {
        env: withoutTailscaleSecrets(process.env),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.child = child;
    child.stderr.resume();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.consume(generation, String(chunk)));
    child.once("error", () => {
      void this.enqueue(() =>
        this.failGeneration(generation, "sidecar_launch_failed"),
      );
    });
    child.once("close", (code) => {
      if (generation !== this.generation || this.child !== child) return;
      this.child = undefined;
      if (this.enabled) {
        void this.enqueue(() =>
          this.failGeneration(
            generation,
            code === 0 ? "sidecar_stopped" : "sidecar_exited",
          ),
        );
      }
    });
  }

  private consume(generation: number, chunk: string): void {
    if (generation !== this.generation) return;
    this.buffer += chunk;
    if (
      Buffer.byteLength(this.buffer, "utf8") > MAX_PROTOCOL_LINE &&
      !this.buffer.includes("\n")
    ) {
      void this.enqueue(() =>
        this.failGeneration(generation, "invalid_sidecar_protocol"),
      );
      return;
    }
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).replace(/\r$/u, "");
      this.buffer = this.buffer.slice(newline + 1);
      try {
        const event = parseFunnelEvent(line);
        void this.enqueue(() => this.handleEvent(generation, event));
      } catch {
        void this.enqueue(() =>
          this.failGeneration(generation, "invalid_sidecar_protocol"),
        );
        return;
      }
    }
  }

  private async handleEvent(
    generation: number,
    event: {
      type: string;
      origin?: string;
      url?: string;
      code?: string;
    },
  ): Promise<void> {
    if (generation !== this.generation || !this.enabled) return;
    if (event.type === "login") {
      this.publish({
        enabled: true,
        state: "needs-login",
        ...(event.url ? { loginUrl: event.url } : {}),
      });
      return;
    }
    if (event.type === "error") {
      await this.failGeneration(generation, event.code ?? "funnel_failed");
      return;
    }
    if (event.type === "ready" || event.type === "serving") {
      const origin = event.origin!;
      let gateway;
      try {
        if (this.gatewayValue) await this.gatewayValue.close();
        this.gatewayValue = undefined;
        gateway = await this.createGateway(origin);
      } catch {
        await this.failGeneration(generation, "gateway_start_failed");
        return;
      }
      if (generation !== this.generation || !this.enabled) {
        await gateway.close();
        return;
      }
      this.gatewayValue = gateway;
      const address = gateway.address();
      const child = this.child;
      if (!child?.stdin) {
        await this.failGeneration(generation, "sidecar_stopped");
        return;
      }
      child.stdin.write(
        `${JSON.stringify({
          version: 1,
          type: "serve",
          target: `http://${address.host}:${String(address.port)}`,
        })}\n`,
        (err) => {
          if (err) {
            void this.enqueue(() =>
              this.failGeneration(generation, "control_channel_failed"),
            );
          }
        },
      );
      this.publish({ enabled: true, state: "ready", origin });
    }
  }
}

export async function createRemoteGatewayFactory(
  upstreamUrl: string,
): Promise<CreateGatewayFn> {
  return async (publicOrigin: string, listenPort = 0) => {
    return startLocalProxyGateway({
      upstreamUrl,
      listenPort,
      publicOrigin,
    });
  };
}
