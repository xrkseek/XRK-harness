/**
 * Shared remote phone-bridge runtime (host + tools + prompt).
 * Process-global via Symbol.for so kind-separated plugins share one map.
 * No Host source edits — long-poll HTTP behind the mobile-access gate.
 *
 * Event chain:
 *   ticket (device cookie | PIN + clientDeviceId) → register
 *     → not-whitelisted → pending (Settings 待批准)
 *     → whitelisted → bridge online after poll (Settings 当前在线)
 *   poll → invoke queue → result
 * Host process restart drops in-memory tickets (whitelist persists on disk);
 * clients must re-ticket on `invalid-ticket`.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const KEY = Symbol.for("xrk.phoneBridge.v1");

const TICKET_TTL_MS = 12 * 60 * 60 * 1000;
const INVOKE_TTL_MS = 120_000;
const DEFAULT_POLL_MS = 25_000;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const ONLINE_STALE_MS = 90_000;
const SAVE_DEBOUNCE_MS = 400;
/** Cap queued invokes per phone so a dead App cannot grow RAM without bound. */
const MAX_INVOKE_QUEUE = 32;
/** Soft GC: drop expired tickets when maps grow past this. */
const TICKET_GC_HINT = 64;

/** @typedef {"unknown"|"pending"|"allowed"|"online"|"offline"} DevicePhase */

function shaDeviceKey(deviceToken) {
  return createHash("sha256").update(String(deviceToken || ""), "utf8").digest("hex").slice(0, 24);
}

function parseCookie(header, name) {
  if (typeof header !== "string" || !header) return "";
  const parts = header.split(";");
  for (const part of parts) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k !== name) continue;
    return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}

/**
 * Resolve device key from dsh_ma_device cookie.
 * Note: browser will NOT send Path=/mobile-access/auth/renew device cookie to
 * /xrk-phone-bridge/*. App clients must forward the cookie header explicitly.
 * PIN-only Face never mints this cookie — use clientDeviceId + operator proof.
 */
function deviceKeyFromReq(req) {
  const raw = parseCookie(req.headers?.cookie, "dsh_ma_device");
  if (!raw) return "";
  return shaDeviceKey(raw);
}

function digestHex(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function accessPinCookieDigest(pin, instanceId) {
  return digestHex(`access-pin:${instanceId}:${pin}`);
}

function safeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** Accepted phone screenshot MIME types (AttachmentStore defaults). */
const ALLOWED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

/**
 * Normalize App-posted screenshot fields: strip data-URL wrappers / whitespace,
 * coerce jpg→jpeg, reject non-image MIME or empty base64.
 * @returns {{ imageBase64: string, imageMime: string } | null}
 */
export function normalizePhoneImagePayload(imageBase64, imageMime) {
  let b64 = typeof imageBase64 === "string" ? imageBase64.trim() : "";
  let mime = typeof imageMime === "string" ? imageMime.trim().toLowerCase() : "";
  if (!b64) return null;
  const dataUrl = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is.exec(b64);
  if (dataUrl) {
    if (!mime) mime = dataUrl[1].toLowerCase();
    b64 = dataUrl[2];
  }
  b64 = b64.replace(/\s+/g, "");
  if (mime === "image/jpg") mime = "image/jpeg";
  if (!ALLOWED_IMAGE_MIME.has(mime)) return null;
  // ~9 MiB decoded ≈ 12 MiB base64 — match RESULT_BODY_LIMIT headroom.
  if (b64.length < 8 || b64.length > 12_000_000) return null;
  return { imageBase64: b64, imageMime: mime === "image/jpg" ? "image/jpeg" : mime };
}

/** Read Host mobile-access state (no Host source edits). */
function loadMobileAccessState(home) {
  if (!home) return null;
  const p = join(home, "mobile-access", "state.json");
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    // Host persists { revision, updatedAt, data: { lanToken, … } }.
    if (raw && typeof raw === "object" && raw.data && typeof raw.data === "object") {
      return raw.data;
    }
    return raw;
  } catch {
    return null;
  }
}

/**
 * True when the request already passed the Face gate (device / session / LAN·WAN PIN).
 * @param {import("node:http").IncomingMessage} req
 * @param {string} home
 */
function requestHasOperator(req, home) {
  const cookie = req.headers?.cookie;
  if (parseCookie(cookie, "dsh_ma_device")) {
    return { ok: true, via: "device" };
  }
  const state = loadMobileAccessState(home);
  const sessionTok = parseCookie(cookie, "dsh_ma_session");
  if (sessionTok && state && Array.isArray(state.sessions)) {
    const key = digestHex(sessionTok);
    if (state.sessions.some((s) => s && safeEqualHex(String(s.key || ""), key))) {
      return { ok: true, via: "session" };
    }
  }
  if (state && state.instanceId) {
    const lan = parseCookie(cookie, "dsh_ma_lan");
    const wan = parseCookie(cookie, "dsh_ma_wan");
    if (
      lan &&
      state.lanToken &&
      safeEqualHex(lan, accessPinCookieDigest(state.lanToken, state.instanceId))
    ) {
      return { ok: true, via: "lan-pin" };
    }
    if (
      wan &&
      state.wanToken &&
      safeEqualHex(wan, accessPinCookieDigest(state.wanToken, state.instanceId))
    ) {
      return { ok: true, via: "wan-pin" };
    }
  }
  // Soft: xrk_operator_ui alone is forgeable — not accepted.
  return { ok: false, via: "" };
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {string} [clientDeviceId]
 */
function resolveDeviceKey(req, clientDeviceId) {
  const fromDevice = deviceKeyFromReq(req);
  if (fromDevice) return { deviceKey: fromDevice, source: "device-cookie" };
  const id = String(clientDeviceId || "").trim();
  if (id.length >= 8) {
    return { deviceKey: shaDeviceKey(`client:${id}`), source: "client-id" };
  }
  return { deviceKey: "", source: "" };
}

function now() {
  return Date.now();
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

export class PhoneBridgeRuntime {
  /**
   * @param {string | undefined} xrkHome
   */
  constructor(xrkHome) {
    this.home = xrkHome || process.env.XRK_HOME || "";
    /** @type {Map<string, { deviceKey: string, expires: number }>} */
    this.tickets = new Map();
    /** @type {Map<string, BridgeSession>} */
    this.bridges = new Map();
    /** @type {Map<string, { deviceKey: string, label: string, lastSeen: number }>} */
    this.pending = new Map();
    /** @type {{ whitelist: Array<{ deviceKey: string, label: string, addedAt: number }>, bindings: Record<string, string>, pending: Array<{ deviceKey: string, label: string, lastSeen: number }> }} */
    this.state = { whitelist: [], bindings: {}, pending: [] };
    this._saveTimer = null;
    this._load();
  }

  statePath() {
    if (!this.home) return "";
    return join(this.home, "phone-bridge", "state.json");
  }

  _load() {
    const p = this.statePath();
    if (!p || !existsSync(p)) return;
    try {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      this.state = {
        whitelist: Array.isArray(raw.whitelist) ? raw.whitelist : [],
        bindings:
          raw.bindings && typeof raw.bindings === "object" && !Array.isArray(raw.bindings)
            ? { ...raw.bindings }
            : {},
        pending: Array.isArray(raw.pending) ? raw.pending : [],
      };
      for (const row of this.state.pending) {
        if (!row || !row.deviceKey) continue;
        this.pending.set(row.deviceKey, {
          deviceKey: row.deviceKey,
          label: row.label || row.deviceKey.slice(0, 8),
          lastSeen: Number(row.lastSeen) || now(),
        });
      }
    } catch {
      // keep empty
    }
  }

  _saveSoon() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  _saveNow() {
    const p = this.statePath();
    if (!p) return;
    ensureDir(join(this.home, "phone-bridge"));
    this.state.pending = this.listPending();
    writeFileSync(
      p,
      JSON.stringify(
        {
          whitelist: this.state.whitelist,
          bindings: this.state.bindings,
          pending: this.state.pending,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  }

  /** Immediate persist (whitelist mutations). */
  _save() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._saveNow();
  }

  isWhitelisted(deviceKey) {
    return this.state.whitelist.some((w) => w.deviceKey === deviceKey);
  }

  listWhitelist() {
    return this.state.whitelist.slice();
  }

  /**
   * @param {string} deviceKey
   * @returns {DevicePhase}
   */
  phaseFor(deviceKey) {
    if (!deviceKey) return "unknown";
    if (!this.isWhitelisted(deviceKey)) {
      return this.pending.has(deviceKey) ? "pending" : "unknown";
    }
    const bridge = this.bridges.get(deviceKey);
    if (bridge && bridge.online && now() - bridge.lastSeen <= ONLINE_STALE_MS) {
      return "online";
    }
    return bridge ? "offline" : "allowed";
  }

  addWhitelist(deviceKey, label) {
    if (!deviceKey) return false;
    const pending = this.pending.get(deviceKey);
    const resolvedLabel = label || pending?.label || deviceKey.slice(0, 8);
    const existing = this.state.whitelist.find((w) => w.deviceKey === deviceKey);
    if (existing) {
      existing.label = resolvedLabel || existing.label;
      this.pending.delete(deviceKey);
      this._save();
      return true;
    }
    this.state.whitelist.push({
      deviceKey,
      label: resolvedLabel,
      addedAt: now(),
    });
    this.pending.delete(deviceKey);
    this._save();
    return true;
  }

  listPending() {
    const out = [];
    for (const p of this.pending.values()) {
      if (this.isWhitelisted(p.deviceKey)) continue;
      if (now() - p.lastSeen > PENDING_TTL_MS) {
        this.pending.delete(p.deviceKey);
        continue;
      }
      out.push({ ...p, phase: "pending" });
    }
    return out.sort((a, b) => b.lastSeen - a.lastSeen);
  }

  removeWhitelist(deviceKey) {
    const before = this.state.whitelist.length;
    this.state.whitelist = this.state.whitelist.filter((w) => w.deviceKey !== deviceKey);
    if (this.state.whitelist.length !== before) {
      const bridge = this.bridges.get(deviceKey);
      if (bridge) this._teardownBridge(bridge, "phone revoked from whitelist");
      // Drop session affinity so a revoked phone cannot keep routing phone_*.
      for (const [sid, key] of Object.entries(this.state.bindings)) {
        if (key === deviceKey) delete this.state.bindings[sid];
      }
      this._save();
      return true;
    }
    return false;
  }

  /**
   * Drop long-poll waiters + pending invokes and mark offline.
   * @param {BridgeSession} bridge
   * @param {string} reason
   */
  _teardownBridge(bridge, reason) {
    bridge.online = false;
    bridge.lastSeen = now();
    bridge.queue.length = 0;
    const waiters = bridge.waiters.splice(0, bridge.waiters.length);
    for (const w of waiters) {
      try {
        w([]);
      } catch {
        // ignore waiter errors
      }
    }
    const pending = [...bridge.pendingResults.entries()];
    bridge.pendingResults.clear();
    for (const [, row] of pending) {
      try {
        row.resolve({ content: reason, isError: true });
      } catch {
        // ignore
      }
    }
  }

  /** Delete expired tickets; keep map bounded after Host uptime + reconnect churn. */
  _gcTickets() {
    if (this.tickets.size < TICKET_GC_HINT) return;
    const t = now();
    for (const [ticket, row] of this.tickets) {
      if (!row || row.expires < t) this.tickets.delete(ticket);
    }
  }

  /** Drop timed-out invoke waiters that somehow stayed in the map. */
  _pruneStalePending(bridge) {
    if (!bridge || bridge.pendingResults.size === 0) return;
    const t = now();
    for (const [id, row] of bridge.pendingResults) {
      if (!row || t - (row.created || 0) <= INVOKE_TTL_MS + 5_000) continue;
      bridge.pendingResults.delete(id);
      try {
        row.resolve({ content: "phone bridge invoke timed out", isError: true });
      } catch {
        // ignore
      }
    }
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {string} [label]
   * @param {string} [clientDeviceId] stable App id when Face is PIN-only (no dsh_ma_device)
   */
  issueTicket(req, label, clientDeviceId) {
    const op = requestHasOperator(req, this.home);
    if (!op.ok) {
      return {
        ok: false,
        error: "not-operator",
        message:
          "Need Face operator proof: dsh_ma_device, dsh_ma_session, or LAN/WAN PIN cookie (dsh_ma_lan / dsh_ma_wan).",
      };
    }
    const resolved = resolveDeviceKey(req, clientDeviceId);
    if (!resolved.deviceKey) {
      return {
        ok: false,
        error: "missing-device-id",
        message:
          "PIN-only Face has no dsh_ma_device. Send body.clientDeviceId (≥8 chars) from the App.",
      };
    }
    this._gcTickets();
    // One live ticket per deviceKey: drop older tickets for the same phone.
    for (const [oldTicket, old] of this.tickets) {
      if (old && old.deviceKey === resolved.deviceKey) this.tickets.delete(oldTicket);
    }
    const ticket = randomBytes(24).toString("hex");
    this.tickets.set(ticket, {
      deviceKey: resolved.deviceKey,
      expires: now() + TICKET_TTL_MS,
    });
    return {
      ok: true,
      ticket,
      deviceKey: resolved.deviceKey,
      label: label || "",
      phase: this.phaseFor(resolved.deviceKey),
      whitelisted: this.isWhitelisted(resolved.deviceKey),
      authVia: op.via,
      deviceKeySource: resolved.source,
    };
  }

  _resolveTicket(ticket) {
    const row = this.tickets.get(ticket);
    if (!row) return null;
    if (row.expires < now()) {
      this.tickets.delete(ticket);
      return null;
    }
    return row;
  }

  register(ticket, label) {
    const row = this._resolveTicket(ticket);
    if (!row) return { ok: false, error: "invalid-ticket" };
    if (!this.isWhitelisted(row.deviceKey)) {
      const lab = label || row.deviceKey.slice(0, 8);
      this.pending.set(row.deviceKey, {
        deviceKey: row.deviceKey,
        label: lab,
        lastSeen: now(),
      });
      this._saveSoon();
      return {
        ok: false,
        error: "not-whitelisted",
        phase: "pending",
        deviceKey: row.deviceKey,
        label: lab,
        message:
          "Waiting for Host whitelist. Open Face Settings → 远程手机桥 and allow this device.",
      };
    }
    let bridge = this.bridges.get(row.deviceKey);
    if (!bridge) {
      bridge = new BridgeSession(row.deviceKey);
      this.bridges.set(row.deviceKey, bridge);
    }
    bridge.label = label || bridge.label || row.deviceKey.slice(0, 8);
    bridge.lastSeen = now();
    // Register alone → allowed; poll marks online (sticky while polling).
    return {
      ok: true,
      phase: bridge.online ? "online" : "allowed",
      deviceKey: row.deviceKey,
      label: bridge.label,
    };
  }

  bindSession(ticket, sessionId) {
    const row = this._resolveTicket(ticket);
    if (!row) return { ok: false, error: "invalid-ticket" };
    if (!this.isWhitelisted(row.deviceKey)) {
      return {
        ok: false,
        error: "not-whitelisted",
        phase: "pending",
        deviceKey: row.deviceKey,
      };
    }
    if (!sessionId || typeof sessionId !== "string") {
      return { ok: false, error: "missing-sessionId" };
    }
    this.state.bindings[sessionId] = row.deviceKey;
    this._save();
    return { ok: true, sessionId, deviceKey: row.deviceKey };
  }

  /**
   * @param {string} ticket
   * @param {number} waitMs
   * @param {AbortSignal} [signal]
   */
  async poll(ticket, waitMs, signal) {
    const row = this._resolveTicket(ticket);
    if (!row) return { ok: false, error: "invalid-ticket" };
    if (!this.isWhitelisted(row.deviceKey)) {
      return {
        ok: false,
        error: "not-whitelisted",
        phase: "pending",
        deviceKey: row.deviceKey,
      };
    }
    let bridge = this.bridges.get(row.deviceKey);
    if (!bridge) {
      bridge = new BridgeSession(row.deviceKey);
      this.bridges.set(row.deviceKey, bridge);
    }
    bridge.lastSeen = now();
    bridge.online = true;
    this._pruneStalePending(bridge);

    const budget = Math.min(Math.max(Number(waitMs) || DEFAULT_POLL_MS, 1000), 55_000);
    const batch = bridge.drainInvokes();
    if (batch.length) return { ok: true, phase: "online", invokes: batch };

    return new Promise((resolve) => {
      let settled = false;
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const idx = bridge.waiters.indexOf(waiter);
        if (idx >= 0) bridge.waiters.splice(idx, 1);
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve(payload);
      };
      const waiter = (invokes) => finish({ ok: true, phase: "online", invokes });
      const onAbort = () => finish({ ok: true, phase: "online", invokes: [] });
      // At most one long-poll waiter per bridge — replace stale App connections.
      if (bridge.waiters.length) {
        const stale = bridge.waiters.splice(0, bridge.waiters.length);
        for (const w of stale) {
          try {
            w([]);
          } catch {
            // ignore
          }
        }
      }
      bridge.waiters.push(waiter);
      const timer = setTimeout(() => finish({ ok: true, phase: "online", invokes: [] }), budget);
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  submitResult(ticket, id, content, isError, imageBase64, imageMime) {
    const row = this._resolveTicket(ticket);
    if (!row) return { ok: false, error: "invalid-ticket" };
    const bridge = this.bridges.get(row.deviceKey);
    if (!bridge) return { ok: false, error: "no-bridge" };
    bridge.lastSeen = now();
    const pending = bridge.pendingResults.get(id);
    if (!pending) return { ok: false, error: "unknown-invoke" };
    bridge.pendingResults.delete(id);
    const payload = {
      content: content == null ? "" : String(content),
      isError: Boolean(isError),
    };
    const image = normalizePhoneImagePayload(imageBase64, imageMime);
    if (image) {
      payload.imageBase64 = image.imageBase64;
      payload.imageMime = image.imageMime;
    }
    pending.resolve(payload);
    return { ok: true };
  }

  markOffline(ticket) {
    const row = this._resolveTicket(ticket);
    if (!row) return { ok: false, error: "invalid-ticket" };
    const bridge = this.bridges.get(row.deviceKey);
    if (bridge) this._teardownBridge(bridge, "phone went offline");
    return { ok: true, phase: this.phaseFor(row.deviceKey) };
  }

  /**
   * Self view for App: ticket or device cookie → phase + next step copy.
   * @param {string} [ticket]
   * @param {import("node:http").IncomingMessage} [req]
   */
  selfStatus(ticket, req) {
    let deviceKey = "";
    if (ticket) {
      const row = this._resolveTicket(ticket);
      if (row) deviceKey = row.deviceKey;
    }
    if (!deviceKey && req) deviceKey = deviceKeyFromReq(req);
    if (!deviceKey) {
      return {
        ok: false,
        error: "unknown-device",
        phase: "unknown",
        message: "No ticket or device cookie.",
      };
    }
    const phase = this.phaseFor(deviceKey);
    const pending = this.pending.get(deviceKey);
    const white = this.state.whitelist.find((w) => w.deviceKey === deviceKey);
    const bridge = this.bridges.get(deviceKey);
    const next =
      phase === "pending"
        ? "Ask Host user to open Settings → 远程手机桥 and allow this device."
        : phase === "allowed" || phase === "offline"
          ? "Enable 手机操控 + accessibility, keep the App open to go online."
          : phase === "online"
            ? "Ready for phone_* tools."
            : "Connect HTTP Host with PIN first.";
    return {
      ok: true,
      phase,
      deviceKey,
      label: bridge?.label || pending?.label || white?.label || "",
      whitelisted: this.isWhitelisted(deviceKey),
      online: phase === "online",
      next,
    };
  }

  onlineBridges() {
    const out = [];
    for (const b of this.bridges.values()) {
      if (!b.online) continue;
      if (!this.isWhitelisted(b.deviceKey)) {
        this._teardownBridge(b, "phone not whitelisted");
        continue;
      }
      if (now() - b.lastSeen > ONLINE_STALE_MS) {
        // Stale poll: wake waiters / fail in-flight so Host tools do not hang.
        this._teardownBridge(b, "phone poll went stale");
        continue;
      }
      out.push({
        deviceKey: b.deviceKey,
        label: b.label,
        lastSeen: b.lastSeen,
        phase: "online",
      });
    }
    return out;
  }

  anyOnline() {
    return this.onlineBridges().length > 0;
  }

  /**
   * @param {string | undefined} sessionId
   * @param {string} name
   * @param {unknown} args
   * @param {AbortSignal} [signal]
   */
  async invoke(sessionId, name, args, signal) {
    const short = name.startsWith("phone_") ? name.slice("phone_".length) : name;
    const online = this.onlineBridges();
    if (!online.length) {
      const pendingCount = this.listPending().length;
      const allowedCount = this.listWhitelist().length;
      let hint =
        "No remote phone is online. On the phone App: HTTP Host + PIN, then enable 手机操控 + accessibility.";
      if (pendingCount > 0) {
        hint =
          "A phone is waiting for whitelist. Open Settings → 远程手机桥 and allow it, then enable 操控 + 无障碍 on the phone.";
      } else if (allowedCount > 0) {
        hint =
          "Phones are whitelisted but none are polling. On the phone: enable 手机操控 + accessibility and keep the App open.";
      }
      return { content: hint, isError: true };
    }

    let deviceKey;
    if (sessionId && this.state.bindings[sessionId]) {
      deviceKey = this.state.bindings[sessionId];
    } else if (online.length === 1) {
      deviceKey = online[0].deviceKey;
    } else {
      return {
        content:
          "Multiple phones are bridged; bind this chat session from the phone App first (affinity), or disconnect extra phones.",
        isError: true,
      };
    }

    if (!this.isWhitelisted(deviceKey)) {
      return { content: "Bound phone is not whitelisted.", isError: true };
    }
    const bridge = this.bridges.get(deviceKey);
    if (!bridge || !bridge.online) {
      return {
        content: `Phone ${deviceKey.slice(0, 8)}… is offline.`,
        isError: true,
      };
    }
    this._pruneStalePending(bridge);
    if (bridge.queue.length >= MAX_INVOKE_QUEUE && bridge.waiters.length === 0) {
      return {
        content:
          "Phone invoke queue is full (App not draining polls). Keep the App open and retry.",
        isError: true,
      };
    }

    const id = randomBytes(12).toString("hex");
    const invoke = {
      id,
      name: short,
      args: args && typeof args === "object" ? args : {},
    };

    return new Promise((resolve) => {
      let settled = false;
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        bridge.pendingResults.delete(id);
        if (signal) signal.removeEventListener("abort", onAbort);
        clearTimeout(timer);
        resolve(payload);
      };
      const onAbort = () =>
        finish({ content: "phone bridge invoke aborted", isError: true });
      bridge.pendingResults.set(id, {
        resolve: (r) => finish(r),
        created: now(),
      });
      const timer = setTimeout(
        () => finish({ content: "phone bridge invoke timed out", isError: true }),
        INVOKE_TTL_MS,
      );
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
      bridge.enqueue(invoke);
    });
  }

  statusForReq(req) {
    const pending = this.listPending();
    const whitelist = this.listWhitelist();
    const online = this.onlineBridges();
    return {
      ok: true,
      whitelist,
      pending,
      online,
      counts: {
        pending: pending.length,
        allowed: whitelist.length,
        online: online.length,
      },
    };
  }
}

class BridgeSession {
  /** @param {string} deviceKey */
  constructor(deviceKey) {
    this.deviceKey = deviceKey;
    this.label = deviceKey.slice(0, 8);
    this.online = false;
    this.lastSeen = 0;
    /** @type {Array<{ id: string, name: string, args: object }>} */
    this.queue = [];
    /** @type {Array<(invokes: object[]) => void>} */
    this.waiters = [];
    /** @type {Map<string, { resolve: (r: { content: string, isError: boolean }) => void, created: number }>} */
    this.pendingResults = new Map();
  }

  enqueue(invoke) {
    if (this.waiters.length) {
      const w = this.waiters.shift();
      w([invoke]);
      return;
    }
    this.queue.push(invoke);
  }

  drainInvokes() {
    if (!this.queue.length) return [];
    return this.queue.splice(0, this.queue.length);
  }
}

/**
 * @param {string | undefined} xrkHome
 * @returns {PhoneBridgeRuntime}
 */
export function getPhoneBridge(xrkHome) {
  const g = globalThis;
  if (!g[KEY]) {
    g[KEY] = new PhoneBridgeRuntime(xrkHome);
  } else if (xrkHome && !g[KEY].home) {
    g[KEY].home = xrkHome;
    g[KEY]._load();
  }
  return g[KEY];
}

export function resetPhoneBridgeForTests() {
  const rt = globalThis[KEY];
  if (rt && rt._saveTimer) clearTimeout(rt._saveTimer);
  delete globalThis[KEY];
}

export {
  deviceKeyFromReq,
  shaDeviceKey,
  parseCookie,
  requestHasOperator,
  resolveDeviceKey,
  accessPinCookieDigest,
};
