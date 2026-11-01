/**
 * Mobile-access gate primitives — network class + PIN / session checks.
 * Shared by any client using LAN or public origins.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./http-json.js";

export type RequestHostClass = "loopback" | "lan" | "wan";
export type MobileGateMode = "none" | "lan" | "wan";

/**
 * Electron Host Fetch stamps this so Desktop shell stays PIN-free while
 * temporary share is on. The LAN share proxy must strip it from clients.
 */
export const DESKTOP_SHELL_MARK_HEADER = "x-xrk-desktop-shell";

/** Set by the Desktop LAN share reverse proxy on every upstream hop. */
export const DESKTOP_SHARE_PROXY_HEADER = "x-xrk-desktop-share";

export interface MobileGateSnapshot {
  readonly running: boolean;
  readonly lanAuthEnabled: boolean;
  readonly lanToken: string;
  readonly wanToken: string;
  readonly instanceId: string;
  /** Bind / listen private IPv4 literals that stay PIN-free (同源 IP). */
  readonly ownLanHosts?: readonly string[];
  /**
   * Desktop temporary share: Host stays on loopback; when share is off,
   * non-loopback callers are closed (not open). When on, they need PIN
   * unless {@link desktopShellTrusted} (Electron shell Fetch).
   * CLI / ordinary web leave this unset (legacy: off ⇒ gate idle).
   */
  readonly desktopShareGate?: boolean;
  /**
   * Request carries {@link DESKTOP_SHELL_MARK_HEADER} from Electron Host Fetch.
   * Only meaningful with {@link desktopShareGate}.
   */
  readonly desktopShellTrusted?: boolean;
}

export interface MobileGateDecision {
  readonly mode: MobileGateMode;
  readonly allowed: boolean;
  readonly pinPath?: string;
  /** Share off on Desktop — refuse remote without offering a PIN form. */
  readonly closed?: boolean;
}

export interface MobileGateCredentials {
  readonly hasDeviceSession: boolean;
  readonly hasLanPin: boolean;
  readonly hasWanPin: boolean;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

export function hostOnly(hostHeader: string | undefined): string {
  const raw = (hostHeader ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end >= 0 ? raw.slice(1, end) : raw;
  }
  return raw.split(":")[0] ?? raw;
}

/** Exposure rank: loopback < lan < wan. Used only to *raise* via XFH. */
function hostClassRank(hostClass: RequestHostClass): number {
  if (hostClass === "loopback") return 0;
  if (hostClass === "lan") return 1;
  return 2;
}

/**
 * Authority used for gate classification.
 * Default: only `Host` (ignores attacker-controlled X-Forwarded-Host).
 * When `trustProxy` is true, X-Forwarded-Host may *raise* class
 * (loopback Host behind LAN share or public reverse proxy → need PIN).
 * It must never *lower* a public/LAN `Host` to loopback — forged
 * `X-Forwarded-Host: 127.0.0.1` would otherwise skip the PIN plane.
 */
export function effectiveRequestHost(
  req: IncomingMessage,
  trustProxy = false,
): string {
  const host = hostOnly(req.headers.host);
  if (!trustProxy) return host;
  const forwarded = req.headers["x-forwarded-host"];
  if (typeof forwarded !== "string" || !forwarded.trim()) return host;
  const fwd = hostOnly(forwarded.split(",")[0]!.trim());
  if (!fwd) return host;
  const hostClass = classifyRequestHost(host);
  const fwdClass = classifyRequestHost(fwd);
  // Share proxy rewrites Host to loopback and sets XFH to the phone / tunnel
  // authority — raise so LAN and WAN visitors both hit the PIN plane.
  if (hostClassRank(fwdClass) > hostClassRank(hostClass)) return fwd;
  return host;
}

export function classifyRequestHost(host: string): RequestHostClass {
  if (!host || LOOPBACK.has(host)) return "loopback";
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return "lan";
    if (a === 192 && b === 168) return "lan";
    if (a === 172 && b >= 16 && b <= 31) return "lan";
    if (a === 169 && b === 254) return "lan";
  }
  return "wan";
}

export function isMobileGateExemptPath(pathname: string): boolean {
  return pathname === "/health" || pathname.startsWith("/mobile-access/");
}

function ownLanSet(snapshot: MobileGateSnapshot): Set<string> {
  const out = new Set<string>();
  for (const raw of snapshot.ownLanHosts ?? []) {
    const h = hostOnly(raw);
    if (h) out.add(h);
  }
  return out;
}

function pinAllowed(
  credentials: MobileGateCredentials,
  snapshot: MobileGateSnapshot,
  preferWan: boolean,
): boolean {
  if (credentials.hasDeviceSession) return true;
  if (preferWan) {
    return Boolean(snapshot.wanToken) && credentials.hasWanPin;
  }
  return Boolean(snapshot.lanToken) && credentials.hasLanPin;
}

/**
 * CLI / ordinary web: loopback free; own LAN free; other LAN/WAN → PIN.
 * Desktop (`desktopShareGate`): share off closes remote; share on requires
 * PIN for every hop except Electron shell mark (Host may still be 127).
 */
export function evaluateMobileGate(
  pathname: string,
  host: string,
  snapshot: MobileGateSnapshot,
  credentials: MobileGateCredentials,
): MobileGateDecision {
  if (isMobileGateExemptPath(pathname)) {
    return { mode: "none", allowed: true };
  }
  const hostClass = classifyRequestHost(host);

  // Desktop: share off closes LAN/WAN. Shell / plain loopback stay up.
  if (snapshot.desktopShareGate === true && !snapshot.running) {
    if (hostClass === "loopback" || snapshot.desktopShellTrusted === true) {
      return { mode: "none", allowed: true };
    }
    return { mode: "none", allowed: false, closed: true };
  }

  // Desktop share ON: only Electron shell Fetch is PIN-free (phone / tunnel / 127).
  if (
    snapshot.desktopShareGate === true &&
    snapshot.running === true &&
    snapshot.desktopShellTrusted === true
  ) {
    return { mode: "none", allowed: true };
  }
  if (snapshot.desktopShareGate === true && snapshot.running === true) {
    const allowed = pinAllowed(credentials, snapshot, true);
    return {
      mode: "wan",
      allowed,
      pinPath: "/mobile-access/wan-pin",
    };
  }

  // CLI / web (no desktopShareGate): classic loopback free.
  if (hostClass === "loopback") {
    return { mode: "none", allowed: true };
  }

  if (!snapshot.running) {
    return { mode: "none", allowed: true };
  }

  const own = ownLanSet(snapshot);
  if (hostClass === "lan" && own.has(hostOnly(host))) {
    return { mode: "none", allowed: true };
  }
  if (hostClass === "lan" && snapshot.lanAuthEnabled === false) {
    return { mode: "none", allowed: true };
  }
  const allowed = pinAllowed(credentials, snapshot, true);
  return {
    mode: "wan",
    allowed,
    pinPath: "/mobile-access/wan-pin",
  };
}

function wantsHtml(req: IncomingMessage): boolean {
  const accept = req.headers.accept ?? "";
  const method = (req.method ?? "GET").toUpperCase();
  return (
    (method === "GET" || method === "HEAD") &&
    (accept.includes("text/html") || accept === "" || accept.includes("*/*"))
  );
}

/** Apply a gate decision to the HTTP response; true = response finished. */
export function applyMobileGateDecision(
  req: IncomingMessage,
  res: ServerResponse,
  decision: MobileGateDecision,
): boolean {
  if (decision.allowed) return false;
  if (decision.closed === true) {
    if (wantsHtml(req)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("Remote access is off. Enable temporary share in Desktop Settings.");
      return true;
    }
    sendJson(res, 403, {
      error: "desktop_share_disabled",
      mode: "none",
    });
    return true;
  }
  const returnTo = encodeURIComponent(
    (req.url ?? "/").startsWith("/") ? (req.url ?? "/") : `/${req.url ?? ""}`,
  );
  const pinUrl = `${decision.pinPath ?? "/mobile-access/wan-pin"}?return=${returnTo}`;
  if (wantsHtml(req)) {
    res.writeHead(302, { location: pinUrl });
    res.end();
    return true;
  }
  sendJson(res, 401, {
    error: "mobile_access_authentication_required",
    mode: decision.mode,
    pinUrl: decision.pinPath,
  });
  return true;
}
