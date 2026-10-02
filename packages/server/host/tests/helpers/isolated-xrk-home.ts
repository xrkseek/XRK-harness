import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Point Host at an empty temp `{XRK_HOME}` so spawn does not pick up the
 * developer's `~/.xrk/host-settings.json` MCP servers (can hang tests).
 * Also disable workspace checkpoints: drain snapshots race git against the
 * monorepo workspace and can exceed vitest's default 5s timeout.
 *
 * `XRK_SURFACE` is cleared for the same reason: the Desktop surface defers the
 * managed process-plugin reconcile until after HTTP listen, so a developer's
 * Desktop shell would otherwise hand spawn an empty `loadedPluginIds`.
 */
export async function withIsolatedXrkHome<T>(
  run: (xrkHome: string) => Promise<T>,
): Promise<T> {
  const xrkHome = await mkdtemp(path.join(tmpdir(), "xrk-host-home-"));
  const prevHome = process.env.XRK_HOME;
  const prevMcp = process.env.XRK_MCP_SERVERS;
  const prevAllow = process.env.XRK_MCP_ALLOW;
  const prevCheckpoints = process.env.XRK_CHECKPOINTS;
  const prevSurface = process.env.XRK_SURFACE;
  process.env.XRK_HOME = xrkHome;
  process.env.XRK_CHECKPOINTS = "0";
  delete process.env.XRK_SURFACE;
  delete process.env.XRK_MCP_SERVERS;
  delete process.env.XRK_MCP_ALLOW;
  try {
    return await run(xrkHome);
  } finally {
    if (prevHome === undefined) delete process.env.XRK_HOME;
    else process.env.XRK_HOME = prevHome;
    if (prevMcp === undefined) delete process.env.XRK_MCP_SERVERS;
    else process.env.XRK_MCP_SERVERS = prevMcp;
    if (prevAllow === undefined) delete process.env.XRK_MCP_ALLOW;
    else process.env.XRK_MCP_ALLOW = prevAllow;
    if (prevCheckpoints === undefined) delete process.env.XRK_CHECKPOINTS;
    else process.env.XRK_CHECKPOINTS = prevCheckpoints;
    if (prevSurface === undefined) delete process.env.XRK_SURFACE;
    else process.env.XRK_SURFACE = prevSurface;
  }
}

/** Merge into `loadHostConfig({ env })` so config + process agree. */
export function isolatedHostEnv(
  xrkHome: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    XRK_HOST: "127.0.0.1",
    XRK_PORT: "0",
    XRK_HOME: xrkHome,
    XRK_CHECKPOINTS: "0",
    ...extra,
  };
}
