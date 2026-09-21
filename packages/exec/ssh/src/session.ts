import {
  createLocalSubprocess,
  type SubprocessHandle,
  type SubprocessResult,
  type SubprocessService,
} from "@xrkseek/exec-subprocess";
import type { SshTargetConfig } from "./config.js";
import { shQuote } from "./quote.js";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface SshExecOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface SshSession {
  readonly config: SshTargetConfig;
  readonly target: string;
  /** Build `ssh … -- <remoteCommand>` argv (no local cwd). */
  buildSshArgv(remoteCommand: string): readonly string[];
  /** Run a remote shell command string (`bash -lc` body). */
  exec(
    remoteCommand: string,
    opts?: SshExecOptions,
  ): Promise<SubprocessResult>;
  /** Start ssh without awaiting (background jobs). */
  start(remoteCommand: string, opts?: SshExecOptions): SubprocessHandle;
  dispose(): void;
}

export interface CreateSshSessionOptions {
  readonly config: SshTargetConfig;
  /** Injectable local OpenSSH client (tests). */
  readonly local?: SubprocessService;
  readonly platform?: NodeJS.Platform;
}

function controlPathFor(target: string): string {
  const dir = path.join(tmpdir(), "xrk-ssh");
  mkdirSync(dir, { recursive: true });
  const id = createHash("sha256").update(target).digest("hex").slice(0, 16);
  return path.join(dir, `${id}.sock`);
}

function resolveTarget(config: SshTargetConfig): string {
  if (config.host.includes("@") || !config.user) return config.host;
  return `${config.user}@${config.host}`;
}

function toSpawnOpts(opts?: SshExecOptions): {
  signal?: AbortSignal;
  timeoutMs?: number;
} {
  return {
    ...(opts?.signal ? { signal: opts.signal } : {}),
    ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  };
}

/**
 * One OpenSSH client session (Hermes-style ControlMaster on POSIX).
 * File/process ops ride `ssh … -- bash -lc` — no remote helper install.
 */
export function createSshSession(
  options: CreateSshSessionOptions,
): SshSession {
  const config = options.config;
  const local = options.local ?? createLocalSubprocess();
  const platform = options.platform ?? process.platform;
  const target = resolveTarget(config);
  const connectTimeoutSec = Math.max(
    1,
    Math.ceil((config.connectTimeoutMs ?? 15_000) / 1000),
  );
  const multiplex = platform !== "win32";
  const controlPath = multiplex ? controlPathFor(target) : undefined;

  const buildSshArgv = (remoteCommand: string): string[] => {
    const argv = ["ssh"];
    if (multiplex && controlPath) {
      argv.push(
        "-o",
        `ControlPath=${controlPath}`,
        "-o",
        "ControlMaster=auto",
        "-o",
        "ControlPersist=300",
      );
    }
    argv.push(
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      `ConnectTimeout=${connectTimeoutSec}`,
    );
    if (config.port !== undefined) {
      argv.push("-p", String(config.port));
    }
    if (config.keyPath) {
      argv.push("-i", config.keyPath);
    }
    argv.push(target, "--", remoteCommand);
    return argv;
  };

  const wrapRemote = (remoteCommand: string, opts?: SshExecOptions): string => {
    const cwd = opts?.cwd ?? config.workspace;
    const envPrefix = opts?.env
      ? Object.entries(opts.env)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${shQuote(k)}=${shQuote(String(v))}`)
          .join(" ")
      : "";
    return envPrefix
      ? `cd ${shQuote(cwd)} && env ${envPrefix} bash -lc ${shQuote(remoteCommand)}`
      : `cd ${shQuote(cwd)} && bash -lc ${shQuote(remoteCommand)}`;
  };

  return {
    config,
    target,
    buildSshArgv,
    exec(remoteCommand, opts) {
      return local.spawn(buildSshArgv(wrapRemote(remoteCommand, opts)), toSpawnOpts(opts));
    },
    start(remoteCommand, opts) {
      return local.start(buildSshArgv(wrapRemote(remoteCommand, opts)), toSpawnOpts(opts));
    },
    dispose() {
      if (!multiplex || !controlPath) return;
      void local
        .spawn([
          "ssh",
          "-o",
          `ControlPath=${controlPath}`,
          "-O",
          "exit",
          target,
        ])
        .catch(() => {});
    },
  };
}
