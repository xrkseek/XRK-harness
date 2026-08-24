/**
 * Mobile access — pairing, LAN/WAN PIN, same-origin control plane (XRK Host).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { networkInterfaces } from "node:os";
import { sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { httpMethod, isMutatingMethod, parseJsonBody } from "./underlying/http-kit.js";
import {
  DEVICE_COOKIE,
  LAN_PIN_COOKIE,
  LAN_PIN_PAGE_HTML,
  LAN_PIN_PAGE_JS,
  LOGIN_PAGE_HTML,
  LOGIN_PAGE_JS,
  mintPairingWindow,
  pairDevice,
  PAIR_PAGE_HTML,
  PAIR_PAGE_JS,
  parseCookieHeader,
  pruneMobileAuth,
  publicDevice,
  renewSession,
  SESSION_COOKIE,
  setAccessPinCookie,
  setMobileSessionCookies,
  WAN_PIN_COOKIE,
  WAN_PIN_PAGE_HTML,
  WAN_PIN_PAGE_JS,
  type MobileAuthState,
  type MobileStoredDevice,
  type MobileStoredSession,
} from "./mobile-access-auth.js";
import {
  getMobileRemoteRuntime,
  type RemoteProviderId,
} from "./mobile-access-remote-runtime.js";
import { qrSvgForText } from "./pocket-qrcode.js";

/**
 * Product-shell mobile seam for `/mobile-access/custom.css`.
 * Clears session header chrome that collides with dsh-mobile / pocket nav.
 */
export const XRK_MOBILE_SHELL_CSS = `/* XRK shell mobile seam */
@media (max-width: 900px) {
  [data-slot="conversation.session.header.actions"],
  [data-slot="conversation.session.header.utilities"] {
    display: none !important;
  }
  [role="tablist"] {
    padding-inline: 44px;
  }
}
`;

/** Inject shell seam stylesheet into product index (works without dsh-mobile fetch). */
export function injectMobileAccessShellIntoHtml(html: string): string {
  if (html.includes("/mobile-access/custom.css")) return html;
  const link = `<link rel="stylesheet" href="/mobile-access/custom.css">`;
  const idx = html.toLowerCase().lastIndexOf("</head>");
  if (idx >= 0) {
    return `${html.slice(0, idx)}${link}${html.slice(idx)}`;
  }
  return `${link}${html}`;
}

export interface MobileAccessOptions {
  readonly xrkHome?: string;
}

interface MobileState extends MobileAuthState {
  running: boolean;
  appKey: string;
  csrf: string;
  customCss: string;
  customJs: string;
  origin: string;
  instanceId: string;
  remoteProvider: RemoteProviderId;
  remoteEnabled: boolean;
  lanIpOverride: string;
  lanAuthEnabled: boolean;
  lanToken: string;
  wanToken: string;
  lanPinCustom: boolean;
  wanPinCustom: boolean;
  restartNotice: boolean;
}

const DEFAULT_STATE: MobileState = {
  running: false,
  appKey: "",
  csrf: "",
  customCss: "",
  customJs: "",
  origin: "",
  instanceId: "",
  pairingToken: "",
  pairingExpiresAt: 0,
  devices: [],
  sessions: [],
  remoteProvider: "tailscale",
  remoteEnabled: false,
  lanIpOverride: "",
  lanAuthEnabled: true,
  lanToken: "",
  wanToken: "",
  lanPinCustom: false,
  wanPinCustom: false,
  restartNotice: false,
};

const MOBILE_STORE = createXrkDocStore(
  ["mobile-access", "state.json"],
  { ...DEFAULT_STATE },
);

function loadState(options: MobileAccessOptions): MobileState {
  const row = MOBILE_STORE.read(options.xrkHome).data;
  const devices: MobileStoredDevice[] = Array.isArray(row.devices)
    ? row.devices
    : [];
  const sessions: MobileStoredSession[] = Array.isArray(row.sessions)
    ? row.sessions
    : [];
  const merged: MobileState = {
    ...DEFAULT_STATE,
    ...row,
    devices,
    sessions,
    remoteProvider:
      row.remoteProvider === "cpolar" ? "cpolar" : "tailscale",
    remoteEnabled: row.remoteEnabled === true,
    lanIpOverride:
      typeof row.lanIpOverride === "string" ? row.lanIpOverride : "",
    lanAuthEnabled: row.lanAuthEnabled !== false,
    lanToken: typeof row.lanToken === "string" ? row.lanToken : "",
    wanToken: typeof row.wanToken === "string" ? row.wanToken : "",
    lanPinCustom: row.lanPinCustom === true,
    wanPinCustom: row.wanPinCustom === true,
    restartNotice: row.restartNotice === true,
  };
  const pruned = pruneMobileAuth({
    pairingToken: merged.pairingToken,
    pairingExpiresAt: merged.pairingExpiresAt,
    devices: merged.devices,
    sessions: merged.sessions,
  });
  return { ...merged, ...pruned };
}

function saveState(
  options: MobileAccessOptions,
  state: MobileState,
): number {
  return MOBILE_STORE.write(options.xrkHome, state).revision;
}

function ensureInstanceId(state: MobileState): MobileState {
  if (state.instanceId) return state;
  return { ...state, instanceId: randomBytes(8).toString("hex") };
}

/** Read-only mobile-access runtime snapshot (revision envelope `data`). */
export function readMobileAccessSnapshot(
  options: MobileAccessOptions,
): Pick<MobileState, "running" | "origin" | "appKey"> {
  const state = loadState(options);
  return {
    running: state.running,
    origin: state.origin,
    appKey: state.appKey,
  };
}

export function readMobileAccessState(options: MobileAccessOptions): MobileState {
  return loadState(options);
}

export function patchMobileAccessState(
  options: MobileAccessOptions,
  patch: Partial<MobileState>,
): MobileState {
  const next = { ...loadState(options), ...patch };
  saveState(options, next);
  return next;
}

export function mint8DigitPin(): string {
  let pin = "";
  for (let i = 0; i < 8; i += 1) {
    pin += String(randomBytes(1)[0]! % 10);
  }
  return pin;
}

export function listLanIPv4Candidates(): string[] {
  const ips: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    if (!entries) continue;
    for (const net of entries) {
      if (net.family === "IPv4" && !net.internal) ips.push(net.address);
    }
  }
  return [...new Set(ips)];
}

export function buildMobileLanUrl(
  state: MobileState,
  req?: IncomingMessage,
): string {
  if (!state.running) return "";
  const base = state.origin || (req ? requestLanOrigin(req) : "");
  if (!base) return "";
  try {
    const url = new URL(base);
    if (state.lanIpOverride) url.hostname = state.lanIpOverride;
    return url.toString().replace(/\/$/, "");
  } catch {
    return base.replace(/\/$/, "");
  }
}

/** Lazy-start LAN access when dsh-pocket settings opens (matches DSH pocket auto-proxy). */
export function ensureMobileAccessRunning(
  options: MobileAccessOptions,
  req?: IncomingMessage,
): MobileState {
  let state = ensureInstanceId(loadState(options));
  if (state.running) return state;
  const port = process.env.XRK_SERVE_PORT?.trim() || "8099";
  const fallbackOrigin = `http://127.0.0.1:${port}`;
  state = {
    ...state,
    running: true,
    origin: req?.headers?.host ? requestLanOrigin(req) : fallbackOrigin,
  };
  if (!state.csrf) state.csrf = mintToken();
  if (!state.lanToken) state.lanToken = mint8DigitPin();
  if (!state.wanToken) state.wanToken = mint8DigitPin();
  saveState(options, state);
  return state;
}

function mintToken(): string {
  return randomBytes(24).toString("base64url");
}

function firstLanIPv4(): string | undefined {
  const nets = networkInterfaces();
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return undefined;
}

function requestOrigin(req: IncomingMessage): string {
  const host = req.headers.host?.trim();
  if (!host) return "";
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ||
    "http";
  return `${proto}://${host}`;
}

function requestTls(req: IncomingMessage): boolean {
  return (
    (req.headers["x-forwarded-proto"] as string | undefined)
      ?.split(",")[0]
      ?.trim() === "https"
  );
}

/** Prefer LAN IPv4 when the Host header is loopback (phone cannot reach 127.0.0.1). */
export function requestLanOrigin(req: IncomingMessage): string {
  const direct = requestOrigin(req);
  if (!direct) return direct;
  try {
    const url = new URL(direct);
    const loopback =
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "::1";
    if (!loopback) return direct;
    const lanIp = firstLanIPv4();
    if (!lanIp) return direct;
    url.hostname = lanIp;
    return url.toString().replace(/\/$/, "");
  } catch {
    return direct;
  }
}

function setCsrfCookie(res: ServerResponse, csrf: string): void {
  res.setHeader(
    "set-cookie",
    `dsh_ma_csrf=${encodeURIComponent(csrf)}; Path=/; SameSite=Strict; HttpOnly`,
  );
}

function componentErrorResponse(err: unknown): { status: number; body: Record<string, unknown> } {
  const error =
    err instanceof Error ? err.message : String(err ?? "unknown_error");
  const status =
    error.includes("unsupported") ||
    error.includes("invalid") ||
    error.includes("authtoken")
      ? 400
      : 500;
  return { status, body: { ok: false, error } };
}

async function prepareRemoteRuntime(
  options: MobileAccessOptions,
  state: MobileState,
  syncEnabled = false,
): Promise<{ runtime: ReturnType<typeof getMobileRemoteRuntime>; state: MobileState }> {
  const withId = ensureInstanceId(state);
  const runtime = getMobileRemoteRuntime(options.xrkHome);
  await runtime.ensureInitialized(withId.instanceId);
  if (runtime.getProvider() !== withId.remoteProvider) {
    await runtime.selectProvider(withId.remoteProvider);
  }
  if (
    syncEnabled &&
    runtime.activeController().status().enabled !== withId.remoteEnabled
  ) {
    await runtime.setRemoteEnabled(withId.remoteEnabled);
  }
  return { runtime, state: withId };
}

function lanPayload(state: MobileState): Record<string, unknown> {
  return {
    running: state.running,
    ...(state.running && state.origin ? { origin: state.origin } : {}),
    extensions: { loaded: 0, failed: 0 },
  };
}

function openLanPairing(
  state: MobileState,
  req: IncomingMessage,
  ttlMs?: number,
): Record<string, unknown> {
  const opened = mintPairingWindow(
    typeof ttlMs === "number" && ttlMs >= 10_000 ? ttlMs : 300_000,
  );
  const withInstance = ensureInstanceId(state);
  const origin = withInstance.origin || requestLanOrigin(req);
  const pairUrl = `${origin}/mobile-access/pair#instance=${withInstance.instanceId}&token=${opened.token}`;
  const appKey = `dsh1.${withInstance.instanceId}.${opened.token}`;
  const qrSvg = (() => {
    try {
      return pairUrl ? qrSvgForText(pairUrl, "pair") : "";
    } catch {
      return "";
    }
  })();
  const next: MobileState = {
    ...withInstance,
    pairingToken: opened.token,
    pairingExpiresAt: opened.expiresAt,
    appKey,
  };
  return {
    token: opened.token,
    expiresAt: opened.expiresAt,
    appKey,
    pairUrl,
    appPairUrl: pairUrl,
    qrSvg,
    next,
  };
}

async function setRunning(
  options: MobileAccessOptions,
  req: IncomingMessage,
  res: ServerResponse,
  running: boolean,
): Promise<void> {
  let state = ensureInstanceId(loadState(options));
  state = { ...state, running };
  if (!state.csrf) state.csrf = mintToken();
  if (running) {
    state.origin = requestLanOrigin(req);
    if (!state.lanToken) state.lanToken = mint8DigitPin();
    if (!state.wanToken) state.wanToken = mint8DigitPin();
  } else {
    state.origin = "";
    state.pairingToken = "";
    state.pairingExpiresAt = 0;
    state.appKey = "";
  }
  saveState(options, state);
  setCsrfCookie(res, state.csrf);
  sendJson(res, 200, lanPayload(state));
}

function sendHtml(res: ServerResponse, body: string, contentType: string): void {
  res.writeHead(200, {
    "content-type": `${contentType}; charset=utf-8`,
    "cache-control": "no-cache",
    "content-length": String(Buffer.byteLength(body)),
  });
  res.end(body);
}

export async function handleMobileAccessHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: MobileAccessOptions,
): Promise<boolean> {
  const method = httpMethod(req);
  const tls = requestTls(req);

  if (pathname === "/mobile-access/pair" && (method === "GET" || method === "HEAD")) {
    sendHtml(res, PAIR_PAGE_HTML, "text/html");
    return true;
  }
  if (pathname === "/mobile-access/pair.js" && (method === "GET" || method === "HEAD")) {
    sendHtml(res, PAIR_PAGE_JS, "application/javascript");
    return true;
  }
  if (pathname === "/mobile-access/login" && (method === "GET" || method === "HEAD")) {
    sendHtml(res, LOGIN_PAGE_HTML, "text/html");
    return true;
  }
  if (pathname === "/mobile-access/login.js" && (method === "GET" || method === "HEAD")) {
    sendHtml(res, LOGIN_PAGE_JS, "application/javascript");
    return true;
  }
  if (pathname === "/mobile-access/lan-pin" && (method === "GET" || method === "HEAD")) {
    sendHtml(res, LAN_PIN_PAGE_HTML, "text/html");
    return true;
  }
  if (pathname === "/mobile-access/lan-pin.js" && (method === "GET" || method === "HEAD")) {
    sendHtml(res, LAN_PIN_PAGE_JS, "application/javascript");
    return true;
  }
  if (pathname === "/mobile-access/wan-pin" && (method === "GET" || method === "HEAD")) {
    sendHtml(res, WAN_PIN_PAGE_HTML, "text/html");
    return true;
  }
  if (pathname === "/mobile-access/wan-pin.js" && (method === "GET" || method === "HEAD")) {
    sendHtml(res, WAN_PIN_PAGE_JS, "application/javascript");
    return true;
  }

  if (pathname === "/mobile-access/auth/lan-pin" || pathname === "/mobile-access/auth/wan-pin") {
    if (!isMutatingMethod(method)) {
      sendJson(res, 405, { error: "method not allowed" });
      return true;
    }
    const body = await parseJsonBody(req);
    const pin = typeof body.pin === "string" ? body.pin.trim() : "";
    const state = ensureInstanceId(loadState(options));
    if (!state.running) {
      sendJson(res, 409, { error: "mobile access is not running" });
      return true;
    }
    const expected =
      pathname.endsWith("/wan-pin") ? state.wanToken : state.lanToken;
    if (!expected || pin !== expected) {
      sendJson(res, 401, { error: "authentication_failed" });
      return true;
    }
    setAccessPinCookie(
      res,
      pathname.endsWith("/wan-pin") ? WAN_PIN_COOKIE : LAN_PIN_COOKIE,
      pin,
      state.instanceId,
      tls,
    );
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === "/mobile-access/health" && (method === "GET" || method === "HEAD")) {
    sendJson(res, 200, { ok: true, service: "xrk-mobile-access" });
    return true;
  }

  if (pathname === "/mobile-access/discovery" && (method === "GET" || method === "HEAD")) {
    const state = loadState(options);
    sendJson(res, 200, {
      instanceId: state.instanceId || ensureInstanceId(state).instanceId,
      origin: state.origin || requestLanOrigin(req),
      running: state.running,
    });
    return true;
  }

  if (
    pathname === "/mobile-access/auth/pair" ||
    pathname === "/mobile-access/auth/native-pair"
  ) {
    if (!isMutatingMethod(method)) {
      sendJson(res, 405, { error: "method not allowed" });
      return true;
    }
    const body = await parseJsonBody(req);
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const label = typeof body.label === "string" ? body.label : undefined;
    const state = loadState(options);
    if (!state.running) {
      sendJson(res, 409, { error: "mobile access is not running" });
      return true;
    }
    try {
      const paired = pairDevice(state, token, label);
      saveState(options, { ...state, ...paired.state });
      setMobileSessionCookies(
        res,
        {
          deviceToken: paired.deviceToken,
          sessionToken: paired.sessionToken,
          csrfToken: paired.csrfToken,
          deviceExpiresAt: paired.deviceExpiresAt,
          sessionExpiresAt: paired.sessionExpiresAt,
        },
        tls,
      );
      if (pathname.endsWith("/native-pair")) {
        sendJson(res, 201, {
          instanceId: state.instanceId,
          deviceId: paired.deviceId,
          deviceToken: paired.deviceToken,
          deviceExpiresAt: paired.deviceExpiresAt,
          sessionToken: paired.sessionToken,
          csrfToken: paired.csrfToken,
          sessionExpiresAt: paired.sessionExpiresAt,
        });
      } else {
        sendJson(res, 200, { ok: true, deviceId: paired.deviceId });
      }
    } catch {
      sendJson(res, 401, { error: "authentication_failed" });
    }
    return true;
  }

  if (pathname === "/mobile-access/auth/renew") {
    if (!isMutatingMethod(method)) {
      sendJson(res, 405, { error: "method not allowed" });
      return true;
    }
    await parseJsonBody(req);
    const deviceToken = parseCookieHeader(req.headers.cookie, DEVICE_COOKIE);
    if (!deviceToken) {
      sendJson(res, 401, { error: "authentication_failed" });
      return true;
    }
    const state = loadState(options);
    try {
      const renewed = renewSession(state, deviceToken);
      const device = renewed.state.devices.find(
        (d) => d.tokenDigest === createHash("sha256").update(deviceToken).digest("hex"),
      );
      saveState(options, { ...state, ...renewed.state });
      setMobileSessionCookies(
        res,
        {
          deviceToken,
          sessionToken: renewed.sessionToken,
          csrfToken: renewed.csrfToken,
          deviceExpiresAt: device?.expiresAt ?? Date.now() + 90 * 24 * 60 * 60 * 1000,
          sessionExpiresAt: renewed.sessionExpiresAt,
        },
        tls,
      );
      sendJson(res, 200, { ok: true });
    } catch {
      sendJson(res, 401, { error: "authentication_failed" });
    }
    return true;
  }

  if (pathname === "/mobile-access/auth/logout") {
    if (!isMutatingMethod(method)) {
      sendJson(res, 405, { error: "method not allowed" });
      return true;
    }
    await parseJsonBody(req);
    const sessionKey = parseCookieHeader(req.headers.cookie, SESSION_COOKIE);
    let state = loadState(options);
    if (sessionKey) {
      const digest = createHash("sha256").update(sessionKey).digest("hex");
      state = {
        ...state,
        sessions: state.sessions.filter((s) => s.key !== digest),
      };
      saveState(options, state);
    }
    res.setHeader("set-cookie", [
      `${DEVICE_COOKIE}=; Path=/mobile-access/auth/renew; Max-Age=0`,
      `${SESSION_COOKIE}=; Path=/; Max-Age=0`,
    ]);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/mobile-access/settings") {
    const state = loadState(options);
    if (method === "GET" || method === "HEAD") {
      sendJson(res, 200, {
        ok: true,
        customCss: state.customCss,
        customJs: state.customJs,
        running: state.running,
        origin: state.origin,
      });
      return true;
    }
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const body = await parseJsonBody(req);
      const next = { ...state };
      if (typeof body.customCss === "string") next.customCss = body.customCss;
      if (typeof body.customJs === "string") next.customJs = body.customJs;
      saveState(options, next);
      sendJson(res, 200, {
        ok: true,
        customCss: next.customCss,
        customJs: next.customJs,
      });
      return true;
    }
  }

  const lanControl =
    pathname === "/api/mobile-access/control" ||
    pathname === "/api/mobile-access/lan/control";
  if (lanControl) {
    const state = loadState(options);
    if (method === "GET" || method === "HEAD") {
      const origin = state.origin || requestLanOrigin(req);
      if (state.running && state.csrf) setCsrfCookie(res, state.csrf);
      sendJson(res, 200, {
        ...lanPayload(state),
        ...(state.running && origin ? { origin } : {}),
      });
      return true;
    }
    if (method === "POST" || method === "PUT") {
      const body = await parseJsonBody(req);
      const running =
        typeof body.running === "boolean" ? body.running : !state.running;
      await setRunning(options, req, res, running);
      return true;
    }
  }

  if (pathname === "/api/mobile-access/pairing/open") {
    if (isMutatingMethod(method)) await parseJsonBody(req);
    const state = loadState(options);
    if (!state.running) {
      sendJson(res, 200, { ok: false, error: "mobile access is not running" });
      return true;
    }
    const opened = openLanPairing(state, req);
    const next = opened.next as MobileState;
    if (!next.csrf) next.csrf = mintToken();
    saveState(options, next);
    setCsrfCookie(res, next.csrf);
    sendJson(res, 200, { ok: true, appKey: next.appKey });
    return true;
  }

  if (pathname === "/api/mobile-access/lan/pairing/open") {
    if (!isMutatingMethod(method)) {
      sendJson(res, 405, { error: "method not allowed" });
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const state = loadState(options);
      if (!state.running) {
        sendJson(res, 409, { error: "mobile access is not running" });
        return true;
      }
      const ttlMs =
        typeof body.ttlMs === "number" ? body.ttlMs : undefined;
      const opened = openLanPairing(state, req, ttlMs);
      const next = opened.next as MobileState;
      if (!next.csrf) next.csrf = mintToken();
      saveState(options, next);
      setCsrfCookie(res, next.csrf);
      sendJson(res, 200, {
        token: opened.token,
        expiresAt: opened.expiresAt,
        appKey: opened.appKey,
        pairUrl: opened.pairUrl,
        appPairUrl: opened.appPairUrl,
        qrSvg: opened.qrSvg,
      });
      return true;
    } catch (err) {
      sendJson(res, 500, {
        error:
          err instanceof Error ? err.message : "pairing_open_failed",
      });
      return true;
    }
  }

  if (pathname === "/api/mobile-access/lan/devices") {
    const state = loadState(options);
    sendJson(res, 200, {
      devices: state.devices.map(publicDevice),
    });
    return true;
  }

  if (pathname === "/api/mobile-access/lan/devices/revoke") {
    const body = await parseJsonBody(req);
    const deviceId =
      typeof body.deviceId === "string" ? body.deviceId.trim() : "";
    if (!deviceId) {
      sendJson(res, 400, { error: "deviceId required" });
      return true;
    }
    const state = loadState(options);
    const next = {
      ...state,
      devices: state.devices.map((d) =>
        d.id === deviceId ? { ...d, revokedAt: Date.now() } : d,
      ),
    };
    if (!next.devices.some((d) => d.id === deviceId)) {
      sendJson(res, 404, { error: "not_found" });
      return true;
    }
    saveState(options, pruneMobileAuth(next) as MobileState);
    sendJson(res, 200, { revoked: true });
    return true;
  }

  if (pathname === "/api/mobile-access/lan/devices/reset") {
    const body = await parseJsonBody(req);
    if (body.confirm !== true) {
      sendJson(res, 400, { error: "confirm required" });
      return true;
    }
    const state = loadState(options);
    saveState(options, { ...state, devices: [], sessions: [] });
    sendJson(res, 200, { reset: true });
    return true;
  }

  if (pathname === "/api/mobile-access/remote/control") {
    const state = loadState(options);
    if (method === "GET" || method === "HEAD") {
      const { runtime } = await prepareRemoteRuntime(options, state);
      sendJson(res, 200, runtime.buildRemotePayload());
      return true;
    }
    if (method === "POST") {
      const body = await parseJsonBody(req);
      const wantRunning = body.running === true;
      const { runtime, state: withId } = await prepareRemoteRuntime(
        options,
        state,
      );
      if (wantRunning && withId.remoteProvider === "cpolar") {
        const component = runtime.cpolarComponent.status();
        if (!component.supported) {
          sendJson(res, 400, {
            error: "cpolar_component_unsupported",
            component,
          });
          return true;
        }
        if (!component.installed) {
          sendJson(res, 503, {
            error: "cpolar_component_missing",
            state: "unavailable",
            component,
          });
          return true;
        }
        if (!component.configured) {
          sendJson(res, 503, {
            error: "cpolar_not_configured",
            state: "unavailable",
            component,
          });
          return true;
        }
      }
      const payload = await runtime.setRemoteEnabled(wantRunning);
      const next = { ...withId, remoteEnabled: wantRunning };
      saveState(options, next);
      sendJson(res, 200, payload);
      return true;
    }
  }

  if (pathname === "/api/mobile-access/remote/provider") {
    const body = await parseJsonBody(req);
    const provider: RemoteProviderId =
      body.provider === "cpolar" ? "cpolar" : "tailscale";
    const state = loadState(options);
    const { runtime, state: withId } = await prepareRemoteRuntime(
      options,
      state,
    );
    await runtime.selectProvider(provider);
    const next = { ...withId, remoteProvider: provider };
    saveState(options, next);
    sendJson(res, 200, runtime.buildRemotePayload());
    return true;
  }

  if (
    pathname === "/api/mobile-access/remote/reconnect" ||
    pathname === "/api/mobile-access/remote/pairing/open"
  ) {
    const state = loadState(options);
    const { runtime } = await prepareRemoteRuntime(options, state);
    const payload = await runtime.reconnect();
    sendJson(res, 200, { ...payload, reopened: true });
    return true;
  }

  if (
    pathname === "/api/mobile-access/remote/devices" ||
    pathname === "/api/mobile-access/remote/devices/revoke" ||
    pathname === "/api/mobile-access/remote/reset" ||
    pathname === "/api/mobile-access/remote/cpolar/component/install" ||
    pathname === "/api/mobile-access/remote/cpolar/configure" ||
    pathname === "/api/mobile-access/remote/cpolar/component/purge"
  ) {
    const state = loadState(options);
    const { runtime } = await prepareRemoteRuntime(options, state);

    if (pathname.endsWith("/devices")) {
      sendJson(res, 200, {
        devices: state.devices.map(publicDevice),
      });
      return true;
    }
    if (pathname.endsWith("/devices/revoke")) {
      const body = await parseJsonBody(req);
      const deviceId =
        typeof body.deviceId === "string" ? body.deviceId.trim() : "";
      if (!deviceId) {
        sendJson(res, 400, { error: "deviceId required" });
        return true;
      }
      const next = {
        ...state,
        devices: state.devices.map((d) =>
          d.id === deviceId ? { ...d, revokedAt: Date.now() } : d,
        ),
      };
      if (!next.devices.some((d) => d.id === deviceId)) {
        sendJson(res, 404, { error: "not_found" });
        return true;
      }
      saveState(options, pruneMobileAuth(next) as MobileState);
      sendJson(res, 200, { revoked: true });
      return true;
    }
    if (pathname.endsWith("/reset")) {
      const payload = await runtime.resetRemote();
      saveState(options, { ...state, remoteEnabled: false });
      sendJson(res, 200, { ...payload, reset: true });
      return true;
    }
    if (pathname.endsWith("/component/install")) {
      if (!isMutatingMethod(method)) {
        sendJson(res, 405, { error: "method not allowed" });
        return true;
      }
      try {
        await runtime.cpolarComponent.install();
        sendJson(res, 200, {
          ok: true,
          component: runtime.cpolarComponent.status(),
        });
      } catch (err) {
        const mapped = componentErrorResponse(err);
        sendJson(res, mapped.status, {
          ...mapped.body,
          component: runtime.cpolarComponent.status(),
        });
      }
      return true;
    }
    if (pathname.endsWith("/configure")) {
      if (!isMutatingMethod(method)) {
        sendJson(res, 405, { error: "method not allowed" });
        return true;
      }
      const body = await parseJsonBody(req);
      const authtoken =
        typeof body.authtoken === "string" ? body.authtoken : "";
      if (!authtoken.trim()) {
        sendJson(res, 400, { error: "authtoken required" });
        return true;
      }
      try {
        await runtime.cpolarComponent.configure(authtoken);
        sendJson(res, 200, {
          ok: true,
          component: runtime.cpolarComponent.status(),
        });
      } catch (err) {
        const mapped = componentErrorResponse(err);
        sendJson(res, mapped.status, {
          ...mapped.body,
          component: runtime.cpolarComponent.status(),
        });
      }
      return true;
    }
    if (pathname.endsWith("/component/purge")) {
      if (!isMutatingMethod(method)) {
        sendJson(res, 405, { error: "method not allowed" });
        return true;
      }
      try {
        await runtime.cpolarComponent.purge();
        sendJson(res, 200, {
          ok: true,
          component: runtime.cpolarComponent.status(),
        });
      } catch (err) {
        const mapped = componentErrorResponse(err);
        sendJson(res, mapped.status, mapped.body);
      }
      return true;
    }
  }

  if (pathname === "/mobile-access/custom.css") {
    const state = loadState(options);
    const custom = state.customCss || "/* dsh-mobile custom css */\n";
    const body = `${XRK_MOBILE_SHELL_CSS}\n${custom}`;
    res.writeHead(200, {
      "content-type": "text/css; charset=utf-8",
      "cache-control": "no-cache",
      "content-length": String(Buffer.byteLength(body)),
    });
    res.end(body);
    return true;
  }

  if (pathname === "/mobile-access/custom.js") {
    const state = loadState(options);
    const body = state.customJs || "/* dsh-mobile custom js */\n";
    res.writeHead(200, {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-cache",
      "content-length": String(Buffer.byteLength(body)),
    });
    res.end(body);
    return true;
  }

  if (pathname === "/mobile-access/extensions/manifest") {
    sendJson(res, 200, { extensions: [] });
    return true;
  }

  return false;
}

export function isMobileAccessPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/mobile-access/") ||
    pathname.startsWith("/mobile-access/")
  );
}
