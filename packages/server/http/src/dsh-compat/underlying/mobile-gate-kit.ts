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
  /** Bind / listen private IPv4 literals that stay PIN-free (同源 IP). */
  readonly ownLanHosts?: readonly string[];
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

/**
 * Authority used for gate classification.
 * Default: only `Host` (ignores attacker-controlled X-Forwarded-Host).
 * When `trustProxy` is true, X-Forwarded-Host may *raise* class to WAN
 * (loopback listen behind a public reverse proxy → need PIN). It must never
 * *lower* a public/LAN `Host` to loopback — forged `X-Forwarded-Host: 127.0.0.1`
 * would otherwise skip the PIN plane.
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
  // Proxy WAN hop: local listen Host + public XFH → classify as public (PIN).
  if (hostClass !== "wan" && fwdClass === "wan") return fwd;
  // Keep the real Host when XFH claims loopback/LAN against a public Host.
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
 * Loopback free; bind LAN IP (ownLanHosts) free; other LAN / WAN → PIN.
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
  const own = ownLanSet(snapshot);
  if (hostClass === "lan" && own.has(hostOnly(host))) {
    return { mode: "none", allowed: true };
  }
  if (hostClass === "lan" && snapshot.lanAuthEnabled === false) {
    return { mode: "none", allowed: true };
  }
  // Non-own private Host or public Host → shared WAN PIN surface.
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
