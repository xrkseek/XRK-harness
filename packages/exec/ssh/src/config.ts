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
