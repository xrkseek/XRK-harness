/**
 * dsh-mobile pairing / device session auth (cookie + token digests).
 */
import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { ServerResponse } from "node:http";

export const DEVICE_COOKIE = "dsh_ma_device";
export const SESSION_COOKIE = "dsh_ma_session";
export const CSRF_COOKIE = "dsh_ma_csrf";
export const CSRF_HEADER = "x-dsh-mobile-csrf";
export const LAN_PIN_COOKIE = "dsh_ma_lan";
export const WAN_PIN_COOKIE = "dsh_ma_wan";

const DEVICE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_DEVICES = 32;

export interface MobileStoredDevice {
  id: string;
  label: string;
  tokenDigest: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  revokedAt?: number;
}

export interface MobileStoredSession {
  key: string;
  deviceId: string;
  csrfDigest: string;
  createdAt: number;
  expiresAt: number;
}

export interface MobileAuthState {
  pairingToken: string;
  pairingExpiresAt: number;
  devices: MobileStoredDevice[];
  sessions: MobileStoredSession[];
}

function digestHex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

function normalizeLabel(label: string | undefined): string {
  const trimmed = (label ?? "Mobile device").trim();
  return trimmed.slice(0, 64) || "Mobile device";
}

function cookie(
  name: string,
  value: string,
  options: {
    path: string;
    maxAgeSeconds: number;
    httpOnly?: boolean;
    tls?: boolean;
  },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${String(Math.max(0, Math.floor(options.maxAgeSeconds)))}`,
    "SameSite=Strict",
  ];
  if (options.tls) parts.push("Secure");
  if (options.httpOnly) parts.push("HttpOnly");
  return parts.join("; ");
}

export function mintPairingWindow(ttlMs = 300_000): {
  token: string;
  expiresAt: number;
} {
  return {
    token: opaqueToken(),
    expiresAt: Date.now() + ttlMs,
  };
}

export function pruneMobileAuth(state: MobileAuthState, now = Date.now()): MobileAuthState {
  return {
    ...state,
    devices: state.devices.filter(
      (d) => !d.revokedAt && d.expiresAt > now,
    ),
    sessions: state.sessions.filter((s) => s.expiresAt > now),
    pairingToken:
      state.pairingExpiresAt > now ? state.pairingToken : "",
    pairingExpiresAt:
      state.pairingExpiresAt > now ? state.pairingExpiresAt : 0,
  };
}

export function pairDevice(
  state: MobileAuthState,
  token: string,
  label: string | undefined,
  now = Date.now(),
): {
  state: MobileAuthState;
  deviceToken: string;
  sessionToken: string;
  csrfToken: string;
  deviceId: string;
  deviceExpiresAt: number;
  sessionExpiresAt: number;
} {
  const pruned = pruneMobileAuth(state, now);
  if (
    !pruned.pairingToken ||
    pruned.pairingExpiresAt <= now ||
    token !== pruned.pairingToken
  ) {
    throw new Error("authentication_failed");
  }
  if (pruned.devices.length >= MAX_DEVICES) {
    throw new Error("device_limit");
  }
  const deviceToken = opaqueToken();
  const sessionToken = opaqueToken();
  const csrfToken = opaqueToken();
  const deviceId = randomBytes(16).toString("hex");
  const deviceExpiresAt = now + DEVICE_TTL_MS;
  const sessionExpiresAt = now + SESSION_TTL_MS;
  const device: MobileStoredDevice = {
    id: deviceId,
    label: normalizeLabel(label),
    tokenDigest: digestHex(deviceToken),
    createdAt: now,
    expiresAt: deviceExpiresAt,
    lastSeenAt: now,
  };
  const session: MobileStoredSession = {
    key: digestHex(sessionToken),
    deviceId,
    csrfDigest: digestHex(csrfToken),
    createdAt: now,
    expiresAt: sessionExpiresAt,
  };
  return {
    state: {
      pairingToken: "",
      pairingExpiresAt: 0,
      devices: [...pruned.devices, device],
      sessions: [...pruned.sessions, session],
    },
    deviceToken,
    sessionToken,
    csrfToken,
    deviceId,
    deviceExpiresAt,
    sessionExpiresAt,
  };
}

export function renewSession(
  state: MobileAuthState,
  deviceToken: string,
  now = Date.now(),
): {
  state: MobileAuthState;
  sessionToken: string;
  csrfToken: string;
  sessionExpiresAt: number;
} {
  const pruned = pruneMobileAuth(state, now);
  const digest = digestHex(deviceToken);
  const device = pruned.devices.find((d) => {
    try {
      return timingSafeEqual(
        Buffer.from(d.tokenDigest, "hex"),
        Buffer.from(digest, "hex"),
      );
    } catch {
      return false;
    }
  });
  if (!device) throw new Error("authentication_failed");
  const sessionToken = opaqueToken();
  const csrfToken = opaqueToken();
  const sessionExpiresAt = now + SESSION_TTL_MS;
  const session: MobileStoredSession = {
    key: digestHex(sessionToken),
    deviceId: device.id,
    csrfDigest: digestHex(csrfToken),
    createdAt: now,
    expiresAt: sessionExpiresAt,
  };
  const devices = pruned.devices.map((d) =>
    d.id === device.id ? { ...d, lastSeenAt: now } : d,
  );
  return {
    state: {
      ...pruned,
      devices,
      sessions: [
        ...pruned.sessions.filter((s) => s.deviceId !== device.id),
        session,
      ],
    },
    sessionToken,
    csrfToken,
    sessionExpiresAt,
  };
}

export function setMobileSessionCookies(
  res: ServerResponse,
  tokens: {
    deviceToken: string;
    sessionToken: string;
    csrfToken: string;
    deviceExpiresAt: number;
    sessionExpiresAt: number;
  },
  tls = false,
): void {
  const now = Date.now();
  res.setHeader("set-cookie", [
    cookie(DEVICE_COOKIE, tokens.deviceToken, {
      path: "/mobile-access/auth/renew",
      maxAgeSeconds: Math.floor((tokens.deviceExpiresAt - now) / 1000),
      httpOnly: true,
      tls,
    }),
    cookie(SESSION_COOKIE, tokens.sessionToken, {
      path: "/",
      maxAgeSeconds: Math.floor((tokens.sessionExpiresAt - now) / 1000),
      httpOnly: true,
      tls,
    }),
    cookie(CSRF_COOKIE, tokens.csrfToken, {
      path: "/",
      maxAgeSeconds: Math.floor((tokens.sessionExpiresAt - now) / 1000),
      httpOnly: true,
      tls,
    }),
  ]);
}

export function parseCookieHeader(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

const ACCESS_PIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function accessPinCookieDigest(
  pin: string,
  instanceId: string,
): string {
  return digestHex(`access-pin:${instanceId}:${pin}`);
}

export function verifyAccessPinCookie(
  cookieValue: string | undefined,
  pin: string,
  instanceId: string,
): boolean {
  if (!cookieValue || !pin || !instanceId) return false;
  const expected = accessPinCookieDigest(pin, instanceId);
  try {
    return timingSafeEqual(Buffer.from(cookieValue), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function verifyMobileSession(
  state: MobileAuthState,
  sessionToken: string | undefined,
  now = Date.now(),
): boolean {
  if (!sessionToken) return false;
  const key = digestHex(sessionToken);
  const pruned = pruneMobileAuth(state, now);
  return pruned.sessions.some((session) => {
    try {
      return timingSafeEqual(
        Buffer.from(session.key, "hex"),
        Buffer.from(key, "hex"),
      );
    } catch {
      return false;
    }
  });
}

export function setAccessPinCookie(
  res: ServerResponse,
  cookieName: string,
  pin: string,
  instanceId: string,
  tls = false,
): void {
  const value = accessPinCookieDigest(pin, instanceId);
  res.setHeader("set-cookie", [
    cookie(cookieName, value, {
      path: "/",
      maxAgeSeconds: Math.floor(ACCESS_PIN_TTL_MS / 1000),
      httpOnly: true,
      tls,
    }),
  ]);
}

export function publicDevice(device: MobileStoredDevice): Record<string, unknown> {
  return {
    deviceId: device.id,
    id: device.id,
    label: device.label,
    createdAt: device.createdAt,
    expiresAt: device.expiresAt,
    lastActiveAt: device.lastSeenAt,
    lastSeenAt: device.lastSeenAt,
  };
}

export const PAIR_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>配对 XRK 移动访问</title>
<main style="font-family:system-ui,sans-serif;max-width:28rem;margin:2rem auto;padding:0 1rem">
  <h1>配对此设备</h1>
  <p>输入桌面端显示的配对码，或从二维码链接自动填充。</p>
  <form id="pair-form">
    <label style="display:block;margin:.75rem 0">配对码
      <input id="pair-token" autocomplete="one-time-code" required style="width:100%;padding:.5rem">
    </label>
    <label style="display:block;margin:.75rem 0">设备名称
      <input id="device-label" maxlength="64" autocomplete="off" style="width:100%;padding:.5rem">
    </label>
    <button type="submit" style="padding:.5rem 1rem">配对</button>
    <output id="pair-status" style="display:block;margin-top:.75rem"></output>
  </form>
</main>
<script src="/mobile-access/pair.js" defer></script>
</html>`;

export const PAIR_PAGE_JS = `(() => {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''))
  const tokenInput = document.getElementById('pair-token')
  const labelInput = document.getElementById('device-label')
  const status = document.getElementById('pair-status')
  const form = document.getElementById('pair-form')
  const hashToken = params.get('token')
  if (hashToken && tokenInput) tokenInput.value = hashToken
  form?.addEventListener('submit', async (event) => {
    event.preventDefault()
    status.textContent = '配对中…'
    const response = await fetch('/mobile-access/auth/pair', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: tokenInput?.value ?? '',
        label: labelInput?.value || undefined,
      }),
    })
    if (!response.ok) {
      status.textContent = '配对失败（链接可能已过期）'
      return
    }
    location.replace('/')
  })
})()
`;

export const LOGIN_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>XRK 移动访问</title>
<main style="font-family:system-ui,sans-serif;max-width:28rem;margin:2rem auto;padding:0 1rem">
  <h1>正在恢复会话…</h1>
  <p id="login-progress">正在验证设备凭据。</p>
  <p id="login-failed" hidden>无法恢复会话，请重新配对。</p>
  <a href="/mobile-access/pair">打开配对页</a>
</main>
<script src="/mobile-access/login.js" defer></script>
</html>`;

export const LOGIN_PAGE_JS = `(() => {
  fetch('/mobile-access/auth/renew', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }).then((response) => {
    if (response.ok) {
      const next = new URLSearchParams(location.search).get('return') || '/'
      location.replace(next)
      return
    }
    document.getElementById('login-progress').hidden = true
    document.getElementById('login-failed').hidden = false
  }).catch(() => {
    const el = document.getElementById('login-progress')
    if (el) el.textContent = '无法连接到主机。'
  })
})()
`;

function pinPageHtml(mode: "lan" | "wan", title: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title}</title>
<main style="font-family:system-ui,sans-serif;max-width:28rem;margin:2rem auto;padding:0 1rem">
  <h1>${title}</h1>
  <p>输入桌面端移动访问设置中显示的 ${mode === "wan" ? "远程" : "局域网"} 访问 PIN。</p>
  <form id="pin-form">
    <label style="display:block;margin:.75rem 0">PIN
      <input id="access-pin" inputmode="numeric" autocomplete="one-time-code" required style="width:100%;padding:.5rem">
    </label>
    <button type="submit" style="padding:.5rem 1rem">继续</button>
    <output id="pin-status" style="display:block;margin-top:.75rem"></output>
  </form>
</main>
<script src="/mobile-access/${mode}-pin.js" defer></script>
</html>`;
}

function pinPageJs(mode: "lan" | "wan"): string {
  return `(() => {
  const status = document.getElementById('pin-status')
  const input = document.getElementById('access-pin')
  document.getElementById('pin-form')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    status.textContent = '验证中…'
    const response = await fetch('/mobile-access/auth/${mode}-pin', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: input?.value ?? '' }),
    })
    if (!response.ok) {
      status.textContent = 'PIN 不正确'
      return
    }
    const next = new URLSearchParams(location.search).get('return') || '/'
    location.replace(next)
  })
})()
`;
}

export const LAN_PIN_PAGE_HTML = pinPageHtml("lan", "局域网访问");
export const WAN_PIN_PAGE_HTML = pinPageHtml("wan", "远程访问");
export const LAN_PIN_PAGE_JS = pinPageJs("lan");
export const WAN_PIN_PAGE_JS = pinPageJs("wan");
