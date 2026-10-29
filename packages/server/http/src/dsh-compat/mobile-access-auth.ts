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

/** Gate pages share product-shell first-paint (index.html) light/dark floors. */
const GATE_SHELL_CSS = `
:root {
  color-scheme: light dark;
  --gate-bg: #f4f4f5;
  --gate-fg: #14161a;
  --gate-muted: #5c6168;
  --gate-border: rgb(0 0 0 / 12%);
  --gate-fill: #14161a;
  --gate-fill-fg: #f4f4f5;
  --gate-fill-hover: #2a2d33;
  --gate-error: #c41e1e;
  --gate-field: #ffffff;
  --gate-ring: #5c6168;
  --gate-ring-dim: rgb(0 0 0 / 14%);
}
html[data-theme="dark"] {
  color-scheme: dark;
  --gate-bg: #151517;
  --gate-fg: #e8e8ea;
  --gate-muted: #9a9aa3;
  --gate-border: rgb(255 255 255 / 12%);
  --gate-fill: #e8e8ea;
  --gate-fill-fg: #151517;
  --gate-fill-hover: #c4c4cc;
  --gate-error: #f25a5a;
  --gate-field: #1c1c1f;
  --gate-ring: #c4c4cc;
  --gate-ring-dim: rgb(255 255 255 / 12%);
}
*, *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  min-height: 100dvh;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--gate-fg);
  background:
    radial-gradient(120% 80% at 50% -10%, rgb(255 255 255 / 70%), transparent 55%),
    radial-gradient(90% 70% at 50% 120%, rgb(20 22 26 / 4%), transparent 50%),
    var(--gate-bg);
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
}
html[data-theme="dark"] body {
  background:
    radial-gradient(120% 80% at 50% -10%, rgb(255 255 255 / 6%), transparent 55%),
    radial-gradient(90% 70% at 50% 120%, rgb(0 0 0 / 35%), transparent 50%),
    var(--gate-bg);
}
.gate {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding:
    max(1.5rem, env(safe-area-inset-top))
    max(1.25rem, env(safe-area-inset-right))
    max(1.75rem, env(safe-area-inset-bottom))
    max(1.25rem, env(safe-area-inset-left));
}
.panel {
  width: min(100%, 22.5rem);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
}
.mark {
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.14em;
  line-height: 1;
  color: var(--gate-fg);
  margin: 0 0 1.75rem;
  text-align: center;
}
h1 {
  margin: 0 0 0.5rem;
  font-size: clamp(1.375rem, 4.2vw, 1.625rem);
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.25;
  text-align: center;
}
.hint {
  margin: 0 0 1.5rem;
  font-size: 0.9375rem;
  line-height: 1.45;
  color: var(--gate-muted);
  text-align: center;
  text-wrap: pretty;
}
form {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}
.field-label {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
#access-pin {
  width: 100%;
  height: 3.25rem;
  padding: 0 1rem;
  border: 1px solid var(--gate-border);
  border-radius: 14px;
  background: var(--gate-field);
  color: var(--gate-fg);
  font-size: 1.375rem;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.28em;
  text-align: center;
  caret-color: var(--gate-fg);
  outline: none;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
#access-pin::placeholder {
  color: var(--gate-muted);
  letter-spacing: 0.12em;
  opacity: 0.7;
}
#access-pin:focus-visible {
  border-color: var(--gate-fg);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--gate-fg) 18%, transparent);
}
#access-pin[aria-invalid="true"] {
  border-color: var(--gate-error);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--gate-error) 22%, transparent);
}
#pin-submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 2.75rem;
  margin: 0;
  padding: 0 1rem;
  border: none;
  border-radius: 18px;
  background: var(--gate-fill);
  color: var(--gate-fill-fg);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 560;
  line-height: 1;
  cursor: pointer;
  transition: background 120ms ease, opacity 120ms ease;
}
#pin-submit:hover:not(:disabled) { background: var(--gate-fill-hover); }
#pin-submit:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
#pin-submit:focus-visible {
  outline: 2px solid var(--gate-fg);
  outline-offset: 2px;
}
#pin-status {
  min-height: 1.25rem;
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.35;
  text-align: center;
  color: var(--gate-muted);
}
#pin-status[data-tone="error"] { color: var(--gate-error); }
#pin-status[data-tone="busy"] { color: var(--gate-muted); }
@media (max-width: 480px) {
  #access-pin {
    height: 3.5rem;
    font-size: 1.5rem;
    letter-spacing: 0.32em;
    border-radius: 16px;
  }
  #pin-submit { height: 3rem; font-size: 1rem; }
}
@media (prefers-reduced-motion: reduce) {
  #access-pin, #pin-submit { transition: none; }
}
`.replace(/\n/g, "");

const GATE_THEME_BOOT = `(function(){
  var dark = typeof matchMedia !== "undefined"
    && matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
})();`;

function pinPageHtml(mode: "lan" | "wan", title: string): string {
  const kind = mode === "wan" ? "远程" : "局域网";
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#151517" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f4f4f5" media="(prefers-color-scheme: light)">
<title>${title} · XRK Harness</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>${GATE_SHELL_CSS}</style>
<script>${GATE_THEME_BOOT}</script>
</head>
<body>
<main class="gate">
  <div class="panel">
    <div class="mark" aria-hidden="true">HARNESS</div>
    <h1>${title}</h1>
    <p class="hint">输入 Host 启动日志中的 8 位${kind}访问 PIN。</p>
    <form id="pin-form" novalidate>
      <label class="field-label" for="access-pin">访问 PIN</label>
      <input
        id="access-pin"
        name="pin"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        enterkeyhint="go"
        maxlength="8"
        pattern="[0-9]{8}"
        placeholder="········"
        required
        autofocus
        spellcheck="false"
        aria-describedby="pin-status"
      >
      <button id="pin-submit" type="submit">进入</button>
      <output id="pin-status" role="status" aria-live="polite"></output>
    </form>
  </div>
</main>
<script src="/mobile-access/${mode}-pin.js" defer></script>
</body>
</html>`;
}

function pinPageJs(mode: "lan" | "wan"): string {
  return `(() => {
  const status = document.getElementById('pin-status')
  const input = document.getElementById('access-pin')
  const submit = document.getElementById('pin-submit')
  const form = document.getElementById('pin-form')
  let busy = false

  const setStatus = (text, tone) => {
    if (!status) return
    status.textContent = text
    if (tone) status.dataset.tone = tone
    else delete status.dataset.tone
  }

  const setBusy = (next) => {
    busy = next
    if (submit) submit.disabled = next
    if (input) input.readOnly = next
  }

  input?.addEventListener('input', () => {
    const digits = (input.value || '').replace(/\\D/g, '').slice(0, 8)
    if (input.value !== digits) input.value = digits
    input.removeAttribute('aria-invalid')
    if (status?.dataset.tone === 'error') setStatus('')
  })

  form?.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy) return
    const pin = (input?.value || '').trim()
    if (!/^\\d{8}$/.test(pin)) {
      input?.setAttribute('aria-invalid', 'true')
      setStatus('请输入 8 位数字 PIN', 'error')
      input?.focus()
      input?.select()
      return
    }
    setBusy(true)
    setStatus('验证中…', 'busy')
    try {
      const response = await fetch('/mobile-access/auth/${mode}-pin', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      if (!response.ok) {
        input?.setAttribute('aria-invalid', 'true')
        setStatus('PIN 不正确，请核对启动日志后重试', 'error')
        setBusy(false)
        input?.focus()
        input?.select()
        return
      }
      try { sessionStorage.setItem('xrk.operatorAccess', '1') } catch {}
      const next = new URLSearchParams(location.search).get('return') || '/'
      location.replace(next)
    } catch {
      setStatus('无法连接 Host，请检查网络后重试', 'error')
      setBusy(false)
    }
  })

  queue?.focus()
})()
`;
}

export const LAN_PIN_PAGE_HTML = pinPageHtml("lan", "局域网访问");
export const WAN_PIN_PAGE_HTML = pinPageHtml("wan", "远程访问");
export const LAN_PIN_PAGE_JS = pinPageJs("lan");
export const WAN_PIN_PAGE_JS = pinPageJs("wan");
