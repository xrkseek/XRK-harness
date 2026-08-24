/**
 * Mobile-access gate primitives — network class + PIN / session checks.
 * Shared by any client using LAN or public origins.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./http-json.js";

export type RequestHostClass = "loopback" | "lan" | "wan";
export type MobileGateMode = "none" | "lan" | "wan";

export interface MobileGateSnapshot {
  readonly running: boolean;
  readonly lanAuthEnabled: boolean;
  readonly lanToken: string;
  readonly wanToken: string;
  readonly instanceId: string;
}

export interface MobileGateDecision {
  readonly mode: MobileGateMode;
  readonly allowed: boolean;
  readonly pinPath?: string;
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

/** Prefer X-Forwarded-Host (tunnel / reverse proxy) over Host. */
export function effectiveRequestHost(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-host"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return hostOnly(forwarded.split(",")[0]!.trim());
  }
  return hostOnly(req.headers.host);
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
  }
  return "wan";
}

export function isMobileGateExemptPath(pathname: string): boolean {
  return pathname === "/health" || pathname.startsWith("/mobile-access/");
}

/**
 * Loopback free; public Host → wan PIN/session;
 * private LAN Host → lan PIN/session when lanAuthEnabled.
 */
export function evaluateMobileGate(
  pathname: string,
  host: string,
  snapshot: MobileGateSnapshot,
  credentials: MobileGateCredentials,
): MobileGateDecision {
  if (isMobileGateExemptPath(pathname) || !snapshot.running) {
    return { mode: "none", allowed: true };
  }
  const hostClass = classifyRequestHost(host);
  if (hostClass === "loopback") {
    return { mode: "none", allowed: true };
  }
  if (hostClass === "wan") {
    const allowed =
      credentials.hasDeviceSession ||
      (Boolean(snapshot.wanToken) && credentials.hasWanPin);
    return {
      mode: "wan",
      allowed,
      pinPath: "/mobile-access/wan-pin",
    };
  }
  if (snapshot.lanAuthEnabled === false) {
    return { mode: "none", allowed: true };
  }
  const allowed =
    credentials.hasDeviceSession ||
    (Boolean(snapshot.lanToken) && credentials.hasLanPin);
  return {
    mode: "lan",
    allowed,
    pinPath: "/mobile-access/lan-pin",
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
