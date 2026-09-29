/**
 * Upstream-Node Desktop Host child: lifecycle IPC + loopback Face Fetch (ADR-0008).
 *
 * DSH Desktop posture — Host listens on 127.0.0.1; Electron loads that origin.
 * No Electron framed Face pipes (Win32 ConPTY must not inherit them).
 */

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import {
  DESKTOP_HOST_PROTOCOL_VERSION,
  type DesktopHostCommand,
  type DesktopHostEvent,
} from "./host-protocol.js";

export interface DesktopHostProcessOptions {
  /** Optional loopback inspector port for development. */
  readonly inspectPort?: number;
  /**
   * Absolute path to the desktop-host entry script.
   * Default: `{projectDir}/node_modules/@xrkseek/harness-desktop-host/dist/index.js`
   */
  readonly entry?: string;
  /**
   * Extra env merged into the child after scrubbing packaging secrets.
   * Use for product knobs Host reads (`XRK_HOME`, `XRK_WEB_DIST`, …).
   */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Fired once the child is spawned — before IPC `ready`.
   * Splash uses this to advance past sticky "Starting Host…" into wiring.
   */
  readonly onSpawned?: () => void;
  /**
   * Fail `start()` if the child never sends IPC `ready` (default 120s).
   * `0` disables the timeout.
   */
  readonly readyTimeoutMs?: number;
}

/** Ready facts reported by one Desktop Host child. */
export interface DesktopHostReady {
  readonly protocolVersion: typeof DESKTOP_HOST_PROTOCOL_VERSION;
  readonly hostVersion: string;
  /** Loopback Face origin for `BrowserWindow.loadURL`. */
  readonly origin: string;
}

function isDesktopHostEvent(message: unknown): message is DesktopHostEvent {
  if (typeof message !== "object" || message === null || !("type" in message)) {
    return false;
  }
  const candidate = message as Record<string, unknown>;
  switch (candidate.type) {
    case "ready":
      return (
        candidate.protocolVersion === DESKTOP_HOST_PROTOCOL_VERSION &&
        typeof candidate.hostVersion === "string" &&
        typeof candidate.origin === "string" &&
        /^https?:\/\/127\.0\.0\.1(?::\d+)?$/u.test(
          (candidate.origin as string).replace(/\/$/u, ""),
        )
      );
    case "fatal":
      return typeof candidate.message === "string";
    default:
      return false;
  }
}

function errorOf(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback);
}

/** IPC channel closed between `connected` check and `child.send` (EPIPE race). */
function isIpcClosedError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EPIPE"
  );
}

async function exitsWithin(
  exit: Promise<void>,
  milliseconds: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, milliseconds);
    timer.unref();
  });
  try {
    return await Promise.race([exit.then(() => true), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function childEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        name !== "NODE_OPTIONS" &&
        // Upstream Node Host must not inherit Electron's process identity —
        // native addons (node-pty / ConPTY) crash the child when
        // ELECTRON_RUN_AS_NODE / related vars leak from the shell main.
        !/^ELECTRON_/u.test(name) &&
        !/^XRK_DESKTOP_/u.test(name) &&
        !/^(?:npm|pnpm|corepack)_/iu.test(name),
    ),
  );
  if (extra === undefined) return base;
  return { ...base, ...extra };
}

function defaultHostEntry(projectDir: string): string {
  return path.join(
    projectDir,
    "node_modules",
    "@xrkseek",
    "harness-desktop-host",
    "dist",
    "index.js",
  );
}

/** One Desktop Host running under a bundled (or test) upstream Node.js executable. */
export class DesktopHostProcess {
  private child: ChildProcess | undefined;
  /** Loopback Face origin from IPC `ready`. */
  private origin: string | undefined;
  private readyResolve!: (ready: DesktopHostReady) => void;
  private readyReject!: (error: Error) => void;
  private readonly readyPromise = new Promise<DesktopHostReady>(
    (resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    },
  );
  private exitPromise: Promise<void> | undefined;
  private stderr = "";
  private readonly inspectPort: number | undefined;
  private readonly entry: string;
  private readonly childEnvironment: NodeJS.ProcessEnv | undefined;
  private readonly onSpawned: (() => void) | undefined;
  private readonly readyTimeoutMs: number;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  /** Set by {@link stop} so attach logic can skip auto-restart on quit. */
  private stopRequested = false;

  constructor(
    private readonly node: string,
    private readonly projectDir: string,
    options: DesktopHostProcessOptions = {},
  ) {
    this.inspectPort = options.inspectPort;
    this.entry = options.entry ?? defaultHostEntry(projectDir);
    this.childEnvironment = options.env;
    this.onSpawned = options.onSpawned;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 120_000;
  }

  /** True after {@link stop} was called (intentional teardown, not a crash). */
  get stopWasRequested(): boolean {
    return this.stopRequested;
  }

  /** Loopback Face origin after {@link start} resolves; `undefined` before ready. */
  get faceOrigin(): string | undefined {
    return this.origin;
  }

  /**
   * Resolves when the Host child exits (crash, shutdown, or never-started).
   * Safe to await after {@link start}; if start never ran, resolves immediately.
   */
  waitForExit(): Promise<void> {
    return this.exitPromise ?? Promise.resolve();
  }

  /** Start the child once; resolve after IPC `ready` (includes loopback `origin`). */
  async start(): Promise<DesktopHostReady> {
    if (this.child !== undefined) return this.readyPromise;
    // Logs + IPC only — no Face framed pipes (fds 3/4).
    const child = spawn(
      this.node,
      [
        ...(this.inspectPort === undefined
          ? []
          : [`--inspect=127.0.0.1:${String(this.inspectPort)}`]),
        this.entry,
        this.projectDir,
      ],
      {
        cwd: this.projectDir,
        env: childEnv(this.childEnvironment),
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true,
      },
    );
    this.child = child;
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.stderr += chunk;
    });
    child.stdout?.pipe(process.stdout);
    child.on("message", (message: unknown) => {
      if (!isDesktopHostEvent(message)) {
        this.fail(new Error("xrk desktop host sent an invalid IPC event"));
        child.kill("SIGTERM");
        return;
      }
      this.handleMessage(message);
    });
    child.on("error", (error) => {
      if (!isIpcClosedError(error)) this.fail(error);
    });
    child.on("disconnect", () => {
      this.fail(new Error("xrk desktop host IPC disconnected"));
      if (this.stopRequested) return;
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        child.kill("SIGTERM");
      } catch {
        // already gone
      }
    });
    this.exitPromise = new Promise<void>((resolve) => {
      child.once("exit", (code) => {
        const suffix =
          this.stderr.trim() === "" ? "" : `: ${this.stderr.trim()}`;
        if (code !== 0 && code !== null) {
          this.fail(
            new Error(`xrk desktop host exited with ${String(code)}${suffix}`),
          );
        } else {
          this.fail(new Error(`xrk desktop host stopped${suffix}`));
        }
        resolve();
      });
    });
    if (this.readyTimeoutMs > 0) {
      this.readyTimer = setTimeout(() => {
        const suffix =
          this.stderr.trim() === "" ? "" : `: ${this.stderr.trim()}`;
        this.fail(
          new Error(
            `xrk desktop host ready timed out after ${String(this.readyTimeoutMs)}ms${suffix}`,
          ),
        );
        child.kill("SIGTERM");
      }, this.readyTimeoutMs);
      this.readyTimer.unref?.();
    }
    try {
      this.onSpawned?.();
    } catch (error) {
      this.fail(errorOf(error, "xrk desktop host onSpawned failed"));
    }
    return this.readyPromise;
  }

  /**
   * Forward one Fetch to the Host loopback origin (smoke / protocol bridge).
   * Rewrites `xrk-app://…` paths onto `http://127.0.0.1:<port>/…`.
   */
  async fetch(request: Request): Promise<Response> {
    const ready = await this.start();
    const child = this.child;
    if (child === undefined || !child.connected || this.origin === undefined) {
      throw new Error("xrk desktop host is unavailable");
    }
    const incoming = new URL(request.url);
    const pathWithQuery = `${incoming.pathname}${incoming.search}`;
    const target = new URL(pathWithQuery, ready.origin);
    const init: RequestInit = {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
    };
    if (request.body !== null) {
      (init as RequestInit & { duplex: "half" }).duplex = "half";
    }
    return globalThis.fetch(new Request(target, init));
  }

  /** Request graceful teardown, then wait for child exit. */
  async stop(): Promise<void> {
    this.stopRequested = true;
    const child = this.child;
    if (child === undefined) return;
    try {
      if (child.connected) this.send({ type: "shutdown" });
    } catch {
      // already gone
    }
    const exited = this.exitPromise ?? Promise.resolve();
    if (!(await exitsWithin(exited, 10_000))) child.kill("SIGTERM");
    if (!(await exitsWithin(exited, 5_000))) {
      child.kill("SIGKILL");
      if (!(await exitsWithin(exited, 5_000))) {
        throw new Error("xrk desktop host did not exit after SIGKILL");
      }
    }
    this.child = undefined;
  }

  private send(message: DesktopHostCommand | DesktopHostEvent): void {
    const child = this.child;
    if (child === undefined || !child.connected) {
      throw new Error("xrk desktop host IPC is unavailable");
    }
    try {
      child.send(message, (error) => {
        if (error !== null && !isIpcClosedError(error)) {
          this.fail(errorOf(error, "xrk desktop host IPC send failed"));
        }
      });
    } catch (error) {
      if (isIpcClosedError(error)) return;
      throw error;
    }
  }

  private handleMessage(message: DesktopHostEvent): void {
    switch (message.type) {
      case "ready":
        if (this.readyTimer !== undefined) {
          clearTimeout(this.readyTimer);
          this.readyTimer = undefined;
        }
        this.origin = message.origin.replace(/\/$/u, "");
        this.readyResolve({
          protocolVersion: message.protocolVersion,
          hostVersion: message.hostVersion,
          origin: this.origin,
        });
        return;
      case "fatal":
        this.fail(new Error(message.message));
        return;
      default:
        message satisfies never;
    }
  }

  private fail(error: Error): void {
    if (this.readyTimer !== undefined) {
      clearTimeout(this.readyTimer);
      this.readyTimer = undefined;
    }
    this.readyReject(error);
  }
}
