/**
 * Generic WebSocket upgrade registry for `host.mjs` `webServer.registerUpgrade`.
 * Product paths (e.g. sidebar PTY) may attach separately on Host.
 */
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

export interface DshCompatUpgradeRoute {
  readonly path: string;
  readonly packageName?: string;
  readonly handler?: (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void;
}

export interface DshCompatUpgradeOptions {
  readonly checkAuth: (req: IncomingMessage) => boolean;
}

const routes: DshCompatUpgradeRoute[] = [];

function normalizeUpgradePath(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed) return "/";
  return trimmed.endsWith("/") && trimmed.length > 1
    ? trimmed.slice(0, -1)
    : trimmed;
}

function honestUpgradeReject(
  socket: Duplex,
  reason = "dsh-upgrade-not-implemented",
): void {
  const body = JSON.stringify({
    ok: false,
    status: "ready",
    incomplete: ["dsh-host"],
    note: reason,
  });
  socket.write(
    `HTTP/1.1 501 Not Implemented\r\n` +
      `Content-Type: application/json\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      `Connection: close\r\n\r\n${body}`,
  );
  socket.destroy();
}

/** Test / host prewarm — clears routes collected from prior adapter install. */
export function resetDshCompatUpgrades(): void {
  routes.length = 0;
}

/** Dedupe by normalized path; used from xrk-host-apply registerUpgrade. */
export function registerDshCompatUpgrade(route: DshCompatUpgradeRoute): void {
  const path = normalizeUpgradePath(route.path);
  if (routes.some((row) => normalizeUpgradePath(row.path) === path)) {
    return;
  }
  routes.push({ ...route, path });
}

export function listDshCompatUpgradePaths(): readonly string[] {
  return routes.map((row) => normalizeUpgradePath(row.path));
}

/**
 * Attach `server.on("upgrade")` for routes registered during adapter compose.
 * Returns before Face / sidebar listeners when pathname does not match.
 */
export function attachDshCompatUpgrades(
  server: Server,
  options: DshCompatUpgradeOptions,
): { close(): void } {
  let closed = false;

  const onUpgrade = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = normalizeUpgradePath(url.pathname);
    const route = routes.find(
      (row) => normalizeUpgradePath(row.path) === pathname,
    );
    if (!route) return;

    if (!options.checkAuth(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    if (typeof route.handler === "function") {
      route.handler(req, socket, head);
      return;
    }
    honestUpgradeReject(socket);
  };

  server.on("upgrade", onUpgrade);

  return {
    close() {
      if (closed) return;
      closed = true;
      server.off("upgrade", onUpgrade);
    },
  };
}
