/**
 * dsh-pocket — same-origin tunnel via mobile-access (XRK-native pocket).
 */
import type { IncomingMessage } from "node:http";
import { readMobileAccessSnapshot } from "./mobile-access.js";
import { honestReady, pocketHostIncomplete } from "./honest-envelope.js";
import { tag } from "./meta.js";

export interface PocketOptions {
  readonly xrkHome?: string;
}

function requestOrigin(req: IncomingMessage): string {
  const host = req.headers.host?.trim();
  if (!host) return "";
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ||
    "http";
  return `${proto}://${host}`;
}

export function buildPocketStatus(
  req: IncomingMessage | undefined,
  options: PocketOptions,
): Record<string, unknown> {
  const mobile = readMobileAccessSnapshot(options);
  const origin =
    mobile.running && mobile.origin
      ? mobile.origin
      : mobile.running && req
        ? requestOrigin(req)
        : "";
  const base = {
    schemaVersion: 1,
    revision: mobile.running ? 1 : 0,
    state: mobile.running ? "connected" : "offline",
    tunnelState: mobile.running
      ? { kind: "same-origin", origin, via: "xrk-mobile-access" }
      : null,
    desktop: false,
    restartNotice: false,
    lanQr: null,
    lanToken: mobile.running ? origin : null,
    tunnelQr: null,
    accessToken: mobile.appKey || null,
    connected: mobile.running,
    configured: mobile.running,
    bots: [],
    totals: { configured: 0, connected: mobile.running ? 1 : 0 },
    provisioning: null,
    testMessage: null,
    agentPresetCatalog: { defaultId: "", items: [] },
    bot: null,
    health: { state: mobile.running ? "ok" : "offline" },
    note: mobile.running
      ? "XRK same-origin pocket via mobile-access."
      : "Enable mobile access to use pocket on XRK.",
    ...honestReady(),
  };
  if (mobile.running) {
    return base;
  }
  return tag(
    {
      ...base,
      ...pocketHostIncomplete(),
    },
    ["pocket-host"],
  );
}

export function handlePocketRpc(
  endpoint: string,
  payload: Record<string, unknown>,
  req: IncomingMessage | undefined,
  options: PocketOptions,
): unknown {
  if (
    endpoint === "pocket.status" ||
    endpoint === "status" ||
    endpoint === "" ||
    endpoint === "connection.status"
  ) {
    return buildPocketStatus(req, options);
  }
  if (endpoint === "pocket.version" || endpoint === "version") {
    return {
      current: "1.0.0-xrk",
      loaded: "1.0.0-xrk",
      ...honestReady(),
    };
  }
  if (endpoint === "pocket.start") {
    const mobile = readMobileAccessSnapshot(options);
    if (!mobile.running) {
      return pocketHostIncomplete({
        ok: false,
        code: "MOBILE_ACCESS_OFF",
        note: "Start mobile-access control first (POST /api/mobile-access/control).",
      });
    }
    return honestReady({ started: true });
  }
  return {
    ok: false,
    endpoint,
    error: "Pocket action not available without mobile-access running",
    ...(readMobileAccessSnapshot(options).running ? {} : pocketHostIncomplete()),
  };
}
