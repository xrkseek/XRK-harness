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

function trustProxyEnabled(options: MobileAccessOptions): boolean {
  if (options.trustProxy === true) return true;
  if (options.trustProxy === false) return false;
  const raw = process.env.XRK_TRUST_PROXY?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Real operator credentials for the PIN plane (HttpOnly digests / device
 * session). The non-HttpOnly `xrk_operator_ui` SPA marker is intentionally
 * ignored here — forging it must never unlock Host Face / settings / keys.
 */
export function credentialsFromRequest(
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

/** True when the request carries a verified PIN cookie or paired device session. */
export function requestHasOperatorPin(
  req: IncomingMessage,
  options: MobileAccessOptions,
): boolean {
  const { hasDeviceSession, hasLanPin, hasWanPin } = credentialsFromRequest(
    req,
    options,
  );
  return hasDeviceSession || hasLanPin || hasWanPin;
}

/**
 * Fetch-Request elevator for Cordis `installOperatorPinElevator` /
 * `isOperatorElevated`. Verifies HttpOnly PIN / device session only —
 * `xrk_operator_ui` is never read.
 */
export function createOperatorPinFetchElevator(
  options: MobileAccessOptions,
): (request: Request) => boolean {
  return (request) => {
    const cookie = request.headers.get("cookie") ?? undefined;
    return requestHasOperatorPin(
      { headers: { cookie } } as IncomingMessage,
      options,
    );
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
    effectiveRequestHost(req, trustProxyEnabled(options)),
    {
      running: snapshot.running,
      lanAuthEnabled: snapshot.lanAuthEnabled !== false,
      lanToken: snapshot.lanToken,
      wanToken: snapshot.wanToken,
      instanceId: snapshot.instanceId,
      ...(options.ownLanHosts && options.ownLanHosts.length > 0
        ? { ownLanHosts: options.ownLanHosts }
        : {}),
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
