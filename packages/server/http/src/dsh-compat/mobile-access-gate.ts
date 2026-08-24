/**
 * Mobile-access Host gate — LAN/WAN PIN for every public surface.
 * Thin adapter over `underlying/mobile-gate-kit`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PublicRouteHandlerFn } from "./underlying/public-handler.js";
import {
  LAN_PIN_COOKIE,
  parseCookieHeader,
  SESSION_COOKIE,
  verifyAccessPinCookie,
  verifyMobileSession,
  WAN_PIN_COOKIE,
} from "./mobile-access-auth.js";
import {
  readMobileAccessState,
  type MobileAccessOptions,
} from "./mobile-access.js";
import {
  applyMobileGateDecision,
  effectiveRequestHost,
  evaluateMobileGate,
  type MobileGateDecision,
} from "./underlying/mobile-gate-kit.js";

function credentialsFromRequest(
  req: IncomingMessage,
  options: MobileAccessOptions,
): {
  hasDeviceSession: boolean;
  hasLanPin: boolean;
  hasWanPin: boolean;
  snapshot: ReturnType<typeof readMobileAccessState>;
} {
  const snapshot = readMobileAccessState(options);
  const cookie = req.headers.cookie;
  return {
    snapshot,
    hasDeviceSession: verifyMobileSession(
      snapshot,
      parseCookieHeader(cookie, SESSION_COOKIE),
    ),
    hasLanPin: verifyAccessPinCookie(
      parseCookieHeader(cookie, LAN_PIN_COOKIE),
      snapshot.lanToken,
      snapshot.instanceId,
    ),
    hasWanPin: verifyAccessPinCookie(
      parseCookieHeader(cookie, WAN_PIN_COOKIE),
      snapshot.wanToken,
      snapshot.instanceId,
    ),
  };
}

export function evaluateMobileAccessGate(
  req: IncomingMessage,
  pathname: string,
  options: MobileAccessOptions,
): MobileGateDecision {
  const { snapshot, ...credentials } = credentialsFromRequest(req, options);
  return evaluateMobileGate(
    pathname,
    effectiveRequestHost(req),
    {
      running: snapshot.running,
      lanAuthEnabled: snapshot.lanAuthEnabled !== false,
      lanToken: snapshot.lanToken,
      wanToken: snapshot.wanToken,
      instanceId: snapshot.instanceId,
    },
    credentials,
  );
}

export async function tryHandleMobileAccessGate(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: MobileAccessOptions,
): Promise<boolean> {
  return applyMobileGateDecision(
    req,
    res,
    evaluateMobileAccessGate(req, pathname, options),
  );
}

/** First link in Host `tryHandlePublic` — gates SPA, `/plugins`, Face HTTP alike. */
export function createMobileAccessGateHandler(
  options: MobileAccessOptions,
): PublicRouteHandlerFn {
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    return tryHandleMobileAccessGate(req, res, url.pathname, options);
  };
}

/** Sync checker for WebSocket upgrades. */
export function createMobileAccessGateChecker(
  options: MobileAccessOptions,
): (req: IncomingMessage) => boolean {
  return (req) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    return evaluateMobileAccessGate(req, url.pathname, options).allowed;
  };
}
