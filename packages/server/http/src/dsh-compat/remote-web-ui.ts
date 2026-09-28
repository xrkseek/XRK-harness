/**
 * `@linxin666/dsh-remote-web-ui` — pair status + persisted web-ui settings.
 * Live LAN pairing / remote.mux upgrade remain honest seat gaps.
 */
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { httpMethod, parseJsonBody } from "./underlying/http-kit.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

export interface RemoteWebUiOptions {
  readonly xrkHome?: string;
}

interface PairDevice {
  id: string;
  name: string;
  online: boolean;
  pairedAt: string;
  lastSeenAt: string;
}

interface RemoteDoc {
  phase: "idle" | "listening" | "paired" | "error";
  devices: PairDevice[];
  settings: Record<string, unknown>;
  pairCode: string | null;
  pairCodeExpiresAt: string | null;
}

const STORE = createXrkDocStore<RemoteDoc>(["dsh-remote-web-ui", "state.json"], {
  phase: "idle",
  devices: [],
  settings: {},
  pairCode: null,
  pairCodeExpiresAt: null,
});

function lanAddresses(): string[] {
  const out: string[] = [];
  const ifaces = networkInterfaces();
  for (const rows of Object.values(ifaces)) {
    if (!rows) continue;
    for (const row of rows) {
      if (row.internal) continue;
      if (row.family !== "IPv4" && String(row.family) !== "4") continue;
      out.push(row.address);
    }
  }
  return out;
}

function pairStatus(doc: RemoteDoc): Record<string, unknown> {
  const lan = lanAddresses();
  const onlineCount = doc.devices.filter((d) => d.online).length;
  return {
    ok: true,
    phase: doc.phase,
    lanAvailable: lan.length > 0,
    lanAddresses: lan,
    deviceCount: doc.devices.length,
    onlineCount,
    devices: doc.devices.map((d) => ({ ...d })),
    pairCode: doc.pairCode,
    pairCodeExpiresAt: doc.pairCodeExpiresAt,
    adapter: DSH_COMPAT_ADAPTER,
  };
}

function seatGap(message: string): Record<string, unknown> {
  return {
    ok: false,
    error: "compat-readonly",
    message,
    adapter: DSH_COMPAT_ADAPTER,
  };
}

export function isRemoteWebUiPath(pathname: string): boolean {
  return (
    pathname === "/api/pair" ||
    pathname.startsWith("/api/pair/") ||
    pathname === "/api/dsh-web-ui-settings" ||
    pathname.startsWith("/api/dsh-web-ui-settings/") ||
    pathname === "/api/remote.mux" ||
    pathname === "/api/session/uploadFileBinary" ||
    pathname === "/remote" ||
    pathname.startsWith("/remote/")
  );
}

export async function handleRemoteWebUiHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: RemoteWebUiOptions = {},
): Promise<boolean> {
  if (!isRemoteWebUiPath(pathname)) return false;
  const method = httpMethod(req);
  const xrkHome = options.xrkHome;

  if (
    pathname === "/api/pair/status" ||
    pathname === "/api/pair" ||
    pathname === "/api/pair/"
  ) {
    if (method === "GET" || method === "HEAD") {
      sendJson(res, 200, pairStatus(STORE.read(xrkHome).data));
      return true;
    }
  }

  if (pathname === "/api/pair/start" || pathname === "/api/pair/listen") {
    await parseJsonBody(req).catch(() => ({}));
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 10 * 60_000).toISOString();
    const doc = STORE.patch(xrkHome, (current) => ({
      ...current,
      phase: "listening" as const,
      pairCode: code,
      pairCodeExpiresAt: expires,
    }));
    sendJson(res, 200, {
      ok: true,
      ...pairStatus(doc.data),
    });
    return true;
  }

  if (pathname === "/api/pair/stop" || pathname === "/api/pair/cancel") {
    await parseJsonBody(req).catch(() => ({}));
    const doc = STORE.patch(xrkHome, (current) => ({
      ...current,
      phase: current.devices.length > 0 ? ("paired" as const) : ("idle" as const),
      pairCode: null,
      pairCodeExpiresAt: null,
    }));
    sendJson(res, 200, { ok: true, ...pairStatus(doc.data) });
    return true;
  }

  if (pathname === "/api/pair/claim" || pathname === "/api/pair/complete") {
    const body = await parseJsonBody(req);
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : "Remote device";
    const now = new Date().toISOString();
    const device: PairDevice = {
      id: randomUUID(),
      name,
      online: true,
      pairedAt: now,
      lastSeenAt: now,
    };
    const doc = STORE.patch(xrkHome, (current) => ({
      ...current,
      phase: "paired" as const,
      pairCode: null,
      pairCodeExpiresAt: null,
      devices: [...current.devices, device],
    }));
    sendJson(res, 200, { ok: true, device, ...pairStatus(doc.data) });
    return true;
  }

  if (
    pathname === "/api/pair/unpair" ||
    pathname === "/api/pair/remove" ||
    pathname === "/api/pair/device"
  ) {
    const body = await parseJsonBody(req);
    const id =
      typeof body.id === "string"
        ? body.id
        : typeof body.deviceId === "string"
          ? body.deviceId
          : "";
    const doc = STORE.patch(xrkHome, (current) => {
      const devices = id
        ? current.devices.filter((d) => d.id !== id)
        : [];
      return {
        ...current,
        devices,
        phase:
          devices.length > 0
            ? ("paired" as const)
            : ("idle" as const),
      };
    });
    sendJson(res, 200, { ok: true, ...pairStatus(doc.data) });
    return true;
  }

  if (pathname.startsWith("/api/pair/")) {
    if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
      await parseJsonBody(req).catch(() => ({}));
    }
    sendJson(res, 200, {
      ...seatGap(
        "This pair action is not wired; status/start/stop/claim/unpair are available.",
      ),
      ...pairStatus(STORE.read(xrkHome).data),
    });
    return true;
  }

  if (
    pathname === "/api/dsh-web-ui-settings" ||
    pathname.startsWith("/api/dsh-web-ui-settings/")
  ) {
    if (method === "GET" || method === "HEAD") {
      const settings = STORE.read(xrkHome).data.settings;
      sendJson(res, 200, {
        ok: true,
        value: settings,
        writable: true,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
    if (method === "PUT" || method === "POST" || method === "PATCH") {
      const body = await parseJsonBody(req);
      const next =
        body.value && typeof body.value === "object"
          ? (body.value as Record<string, unknown>)
          : body.settings && typeof body.settings === "object"
            ? (body.settings as Record<string, unknown>)
            : body;
      const doc = STORE.patch(xrkHome, (current) => ({
        ...current,
        settings: { ...current.settings, ...next },
      }));
      sendJson(res, 200, {
        ok: true,
        value: doc.data.settings,
        writable: true,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
  }

  if (pathname === "/api/remote.mux") {
    sendJson(res, 426, {
      ok: false,
      error: "upgrade-required",
      message: "remote.mux requires WebSocket upgrade (not embedded here).",
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname === "/api/session/uploadFileBinary") {
    await parseJsonBody(req).catch(() => ({}));
    sendJson(res, 200, {
      ...seatGap("Binary session upload is not persisted on XRK-Harness."),
    });
    return true;
  }

  if (pathname === "/remote" || pathname === "/remote/" || pathname.startsWith("/remote/")) {
    sendJson(res, 200, {
      ok: true,
      path: pathname,
      phase: STORE.read(xrkHome).data.phase,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  sendJson(res, 200, {
    ok: true,
    path: pathname,
    adapter: DSH_COMPAT_ADAPTER,
  });
  return true;
}
