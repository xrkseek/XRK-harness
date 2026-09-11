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

export interface CommunityClientAudit {
  readonly httpPaths: readonly string[];
  readonly rpcChannels: readonly string[];
  readonly missingHttp: readonly string[];
  readonly coverage: Readonly<Record<string, CommunityHttpCoverage>>;
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
  return {
    httpPaths: scanned.httpPaths,
    rpcChannels: scanned.rpcChannels,
    missingHttp,
    coverage,
  };
}
