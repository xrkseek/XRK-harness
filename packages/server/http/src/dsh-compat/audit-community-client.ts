/**
 * Audit staged `client.js` HTTP/RPC surfaces against global dsh-compat capabilities.
 * Dev/test gate only — runtime routing uses `dsh-path-capabilities` + `adapter-compose`.
 */
import { isCommunityRootPath } from "./community-root-http.js";
import { scanClientHostSurface } from "./dsh-client-scan.js";
import {
  httpCapabilityForPath,
  matchesBaselineRpcChannel,
} from "./dsh-path-capabilities.js";

export type CommunityHttpCoverage =
  | "capability"
  | "community-root"
  | "host-sidebar"
  | "npm-registry"
  | "dsh-generic"
  | "settings-rpc"
  | "rpc-channel"
  | "dev-placeholder"
  | "missing";

/**
 * Seat coverage for slot registrations in community client.js.
 * Mirrors the XRK shell seat map (ui-layout SlotMap): only these four seats
 * have a render authority in the product shell. DSH 0.1.5+ global-panel
 * shapes (`sidebar.panellist`, `main`, `main.conversation`) are real gaps —
 * SlotCore throws "not declared" on unknown names, so they are surfaced
 * here instead of being silently claimed.
 */
export type CommunitySeatCoverage = "shell-seat" | "missing-seat";

/** Seats declared by the product shell (ui-layout AppFrame children). */
const XRK_SHELL_SEATS = new Set([
  "root",
  "sidebar",
  "conversation",
  "details",
  "shell.overlay",
]);

export function classifyCommunitySeat(seat: string): CommunitySeatCoverage {
  if (XRK_SHELL_SEATS.has(seat)) return "shell-seat";
  return "missing-seat";
}

export interface CommunityClientAudit {
  readonly httpPaths: readonly string[];
  readonly rpcChannels: readonly string[];
  readonly missingHttp: readonly string[];
  readonly coverage: Readonly<Record<string, CommunityHttpCoverage>>;
  readonly slotSeats: readonly string[];
  readonly missingSeats: readonly string[];
  readonly seatCoverage: Readonly<Record<string, CommunitySeatCoverage>>;
}

/** npm registry metadata shape `/{pkg}/latest` — not a product Host route. */
export function isNpmRegistryLatestPath(pathname: string): boolean {
  const p = pathname.split("?")[0] ?? pathname;
  if (p === "/latest" || p.startsWith("/releases")) return false;
  return /^\/[a-z0-9][a-z0-9._-]*\/latest$/.test(p);
}

export function classifyCommunityHttpPath(pathname: string): CommunityHttpCoverage {
  const p = pathname.split("?")[0] ?? pathname;
  if (matchesBaselineRpcChannel(p)) return "rpc-channel";
  // Host-native `/sidebar/*` (createSidebarPublicHandler) — not dsh-compat gaps.
  if (p === "/sidebar" || p.startsWith("/sidebar/")) return "host-sidebar";
  // Community clients probe npm registries with `/{pkg}/latest` (e.g. dsh-context).
  if (isNpmRegistryLatestPath(p)) return "npm-registry";
  if (isCommunityRootPath(p)) return "community-root";
  if (p.startsWith("/dev/") || p.includes("/absolute/")) return "dev-placeholder";
  if (httpCapabilityForPath(p)) return "capability";
  if (p.startsWith("/_dsh/")) return "dsh-generic";
  if (p.includes("-settings")) return "settings-rpc";
  return "missing";
}

export function auditCommunityClientSurface(pkgRoot: string): CommunityClientAudit {
  const scanned = scanClientHostSurface(pkgRoot);
  const coverage: Record<string, CommunityHttpCoverage> = {};
  const missingHttp: string[] = [];
  for (const path of scanned.httpPaths) {
    const kind = classifyCommunityHttpPath(path);
    coverage[path] = kind;
    if (kind === "missing") missingHttp.push(path);
  }
  const seatCoverage: Record<string, CommunitySeatCoverage> = {};
  const missingSeats: string[] = [];
  for (const seat of scanned.slotSeats) {
    const kind = classifyCommunitySeat(seat);
    seatCoverage[seat] = kind;
    if (kind === "missing-seat") missingSeats.push(seat);
  }
  return {
    httpPaths: scanned.httpPaths,
    rpcChannels: scanned.rpcChannels,
    missingHttp,
    coverage,
    slotSeats: scanned.slotSeats,
    missingSeats,
    seatCoverage,
  };
}
