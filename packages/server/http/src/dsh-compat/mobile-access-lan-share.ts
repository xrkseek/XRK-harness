/**
 * Desktop temporary share: `0.0.0.0` reverse proxy in front of the loopback
 * Desktop Host — Wi‑Fi phones and (optionally) tunnel tools that target the
 * share listen. Process-scoped; Host dispose / toggle-off closes it.
 *
 * Tunnel tip: point 樱花 / frp / cpolar at `localOrigin` (share listen on
 * 127.0.0.1), not a hard-coded 8787. Share ON arms the PIN gate for
 * non-loopback / X-Forwarded-Host; share OFF closes remote class.
 */
import { networkInterfaces } from "node:os";
import {
  startLocalProxyGateway,
  type LocalMobileGateway,
} from "./mobile-access-local-gateway.js";

let liveGateway: LocalMobileGateway | undefined;

/**
 * Preferred share listen ports. Host already owns loopback 8787 on Desktop,
 * so 0.0.0.0:8787 often fails — fall through. Env `XRK_DESKTOP_SHARE_PORT`
 * overrides the first candidate when set to a positive int.
 */
export function desktopSharePortCandidates(): readonly number[] {
  const fromEnv = Number(
    String(process.env.XRK_DESKTOP_SHARE_PORT ?? "").trim(),
  );
  if (Number.isFinite(fromEnv) && fromEnv > 0 && fromEnv < 65536) {
    return [Math.floor(fromEnv), 8787, 18787];
  }
  // 8787 first for tunnel recipes that expect the familiar product port;
  // 18787 when Host already holds loopback 8787.
  return [8787, 18787];
}

/** Non-internal IPv4 addresses suitable for phone URL display. */
export function listLanIPv4Addresses(): readonly string[] {
  const out: string[] = [];
  const nets = networkInterfaces();
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      if (net.family !== "IPv4" || net.internal) continue;
      const ip = net.address.trim();
      if (!ip || out.includes(ip)) continue;
      out.push(ip);
    }
  }
  return out;
}

/** VirtualBox / VMware host-only — phones on real Wi‑Fi cannot reach these. */
export function isHostOnlyLanIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  const c = Number(parts[2]);
  // VirtualBox host-only default, VMware host-only common ranges.
  if (a === 192 && b === 168 && (c === 56 || c === 57 || c === 254)) {
    return true;
  }
  return false;
}

/**
 * Prefer private Wi‑Fi / Ethernet; skip host-only NICs when any better IP exists.
 */
export function pickPreferredLanIPv4(
  addresses: readonly string[] = listLanIPv4Addresses(),
): string | undefined {
  if (addresses.length === 0) return undefined;
  const usable = addresses.filter((ip) => !isHostOnlyLanIPv4(ip));
  const pool = usable.length > 0 ? usable : addresses;
  const scored = [...pool].sort((a, b) => scoreLanIp(b) - scoreLanIp(a));
  return scored[0];
}

function scoreLanIp(ip: string): number {
  const parts = ip.split(".");
  if (parts.length !== 4) return 0;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (a === 10) return 40;
  if (a === 192 && b === 168) return isHostOnlyLanIPv4(ip) ? 5 : 35;
  if (a === 172 && b >= 16 && b <= 31) return 30;
  if (a === 169 && b === 254) return 5;
  return 10;
}

export async function stopLanShareGateway(): Promise<void> {
  const gw = liveGateway;
  liveGateway = undefined;
  if (gw) await gw.close();
}

/**
 * Bind LAN share proxy → loopback Host. Returns public origin for phones.
 * Omits `publicOrigin` so the phone `Host` header drives X-Forwarded-Host.
 */
export async function startLanShareGateway(options: {
  readonly upstreamOrigin: string;
  readonly listenPort?: number;
  readonly lanIp?: string;
}): Promise<{
  readonly origin: string;
  /** Same share listen via loopback — for this PC / tunnel tools. */
  readonly localOrigin: string;
  readonly port: number;
  readonly lanIp: string;
  readonly lanHosts: readonly string[];
}> {
  const upstream = options.upstreamOrigin.trim().replace(/\/$/, "");
  if (!upstream) {
    throw new Error("lan_share_missing_upstream");
  }
  const lanHosts = listLanIPv4Addresses();
  const preferred = pickPreferredLanIPv4(lanHosts);
  const requested = options.lanIp?.trim() ?? "";
  // Ignore a host-only NIC when a real Wi‑Fi / Ethernet address exists.
  const lanIp =
    (requested &&
    lanHosts.includes(requested) &&
    (!isHostOnlyLanIPv4(requested) || preferred === undefined)
      ? requested
      : undefined) ||
    preferred ||
    lanHosts[0];
  if (!lanIp) {
    throw new Error("lan_share_no_lan_ip");
  }

  await stopLanShareGateway();
  const ports =
    options.listenPort !== undefined
      ? [options.listenPort]
      : [...desktopSharePortCandidates(), 0];
  let lastErr: unknown;
  let gateway: LocalMobileGateway | undefined;
  for (const listenPort of ports) {
    try {
      gateway = await startLocalProxyGateway({
        upstreamUrl: upstream,
        listenHost: "0.0.0.0",
        ...(listenPort > 0 ? { listenPort } : {}),
      });
      break;
    } catch (err) {
      lastErr = err;
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code)
          : "";
      if (code !== "EADDRINUSE" && code !== "EACCES") throw err;
    }
  }
  if (!gateway) {
    throw lastErr instanceof Error
      ? lastErr
      : new Error("lan_share_listen_failed");
  }
  liveGateway = gateway;
  const { port } = gateway.address();
  const origin = `http://${lanIp}:${String(port)}`;
  const localOrigin = `http://127.0.0.1:${String(port)}`;
  return { origin, port, lanIp, lanHosts, localOrigin };
}

export function lanShareGatewayAddress():
  | { host: string; port: number; origin?: string }
  | undefined {
  return liveGateway?.address();
}
