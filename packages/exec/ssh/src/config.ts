/** Deployment-owned SSH target (OpenSSH client on the Host). */
export interface SshTargetConfig {
  /** OpenSSH host alias or hostname (may already include `user@`). */
  readonly host: string;
  /** Absolute remote workspace cwd. */
  readonly workspace: string;
  readonly user?: string;
  readonly port?: number;
  readonly keyPath?: string;
  /** Remote Node executable for `run_code` (default `node`). */
  readonly nodeExecutable?: string;
  /** Administrative / connect timeout for one ssh exec (ms). */
  readonly connectTimeoutMs?: number;
}

export type SshEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

/**
 * Read `XRK_SSH_*`. Returns undefined unless both host and workspace are set.
 * Workspace must be an absolute POSIX path (`/…`).
 */
export function resolveSshConfigFromEnv(env: SshEnv = process.env):
  | SshTargetConfig
  | undefined {
  const host = String(env.XRK_SSH_HOST ?? "").trim();
  const workspace = String(env.XRK_SSH_WORKSPACE ?? "").trim();
  if (!host || !workspace) return undefined;
  if (!workspace.startsWith("/")) {
    throw new Error(
      "XRK_SSH_WORKSPACE must be an absolute remote path (POSIX, starting with /)",
    );
  }
  const user = String(env.XRK_SSH_USER ?? "").trim();
  const keyPath = String(env.XRK_SSH_KEY ?? "").trim();
  const nodeExecutable = String(env.XRK_SSH_NODE ?? "").trim();
  const portRaw = String(env.XRK_SSH_PORT ?? "").trim();
  const port = portRaw ? Number(portRaw) : undefined;
  if (port !== undefined && (!Number.isFinite(port) || port <= 0)) {
    throw new Error(`XRK_SSH_PORT must be a positive number, got ${portRaw}`);
  }
  return {
    host,
    workspace,
    ...(user ? { user } : {}),
    ...(port !== undefined ? { port } : {}),
    ...(keyPath ? { keyPath } : {}),
    ...(nodeExecutable ? { nodeExecutable } : {}),
  };
}

/**
 * Normalize Face `ssh-remote` (or any plain object) into target fields.
 * Empty host/workspace → undefined (local workspace).
 */
export function parseSshRemoteProduct(
  raw: unknown,
): SshTargetConfig | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const host = typeof o.host === "string" ? o.host.trim() : "";
  const workspace = typeof o.workspace === "string" ? o.workspace.trim() : "";
  if (!host || !workspace) return undefined;
  if (!workspace.startsWith("/")) {
    throw new Error(
      "ssh-remote.workspace must be an absolute remote path (POSIX, starting with /)",
    );
  }
  const user = typeof o.user === "string" ? o.user.trim() : "";
  const keyPath = typeof o.keyPath === "string" ? o.keyPath.trim() : "";
  const nodeExecutable =
    typeof o.nodeExecutable === "string" ? o.nodeExecutable.trim() : "";
  let port: number | undefined;
  if (typeof o.port === "number" && Number.isFinite(o.port) && o.port > 0) {
    port = Math.trunc(o.port);
  } else if (typeof o.port === "string" && o.port.trim()) {
    const n = Number(o.port.trim());
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`ssh-remote.port must be a positive number, got ${o.port}`);
    }
    port = Math.trunc(n);
  }
  return {
    host,
    workspace,
    ...(user ? { user } : {}),
    ...(port !== undefined ? { port } : {}),
    ...(keyPath ? { keyPath } : {}),
    ...(nodeExecutable ? { nodeExecutable } : {}),
  };
}

/**
 * Resolve SSH target: non-empty `XRK_SSH_HOST` is CI bypass (env wins, like
 * Hermes `TERMINAL_SSH_*` / sandbox `XRK_SANDBOX_BACKEND`); else Face product.
 */
export function resolveSshConfig(
  env: SshEnv = process.env,
  product?: unknown,
): SshTargetConfig | undefined {
  const envBypass = String(env.XRK_SSH_HOST ?? "").trim() !== "";
  if (envBypass) return resolveSshConfigFromEnv(env);
  return parseSshRemoteProduct(product);
}
