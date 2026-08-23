/**
 * Scan staged `client.js` for Cordis-shaped Host paths (no per-package catalog).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const QUOTED_PATH =
  /["'`](\/(?:api\/[a-zA-Z0-9._/-]+|api-[a-zA-Z0-9._/-]+|wallet\/api\/[a-zA-Z0-9._/-]+|_dsh\/[a-zA-Z0-9._/-]+|dsh-[a-zA-Z0-9._/-]+|sidebar\/[a-zA-Z0-9._/-]+|modlens[/?a-zA-Z0-9._-]*|modsearch[/?a-zA-Z0-9._-]*|auto-review[/?a-zA-Z0-9._-]*|api\/harness\/connector[/?a-zA-Z0-9._/-]*|\.well-known\/[a-zA-Z0-9._/-]+|dream-skin\/[a-zA-Z0-9._/-]+|wallpaper-engine[/?a-zA-Z0-9._-]*|tongflow\/[a-zA-Z0-9._/-]+|mobile-access\/[a-zA-Z0-9._/-]+|plugins\/[a-zA-Z0-9._/-]+|projects[/?a-zA-Z0-9._-]*|Looks[/?a-zA-Z0-9._/-]*|Materials[/?a-zA-Z0-9._/-]*))["'`]/g;

const BACKTICK_PATH =
  /`(\/(?:api\/[a-zA-Z0-9._/-]+|api-[a-zA-Z0-9._/-]+|_dsh\/[a-zA-Z0-9._/-]+|dsh-[a-zA-Z0-9._/-]+|sidebar\/[a-zA-Z0-9._/-]+|modlens[/?a-zA-Z0-9._-]*|\.well-known\/[a-zA-Z0-9._/-]+))`/g;

const FETCH_PATH =
  /fetch\s*\(\s*["'`](\/[^"'`$]+)["'`]/g;

const RPC_LITERAL =
  /(?:registerRpc|rpc|postRpc)\s*\(\s*["'`](\/[^"'`]+)["'`]/gi;

const RPC_CHANNEL =
  /["'`](\/(?:dsh-)?[a-zA-Z][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9_$./-]+)?)["'`]/g;

function normalizeHttpPath(raw: string): string {
  const noQuery = raw.split("?")[0] ?? raw;
  if (noQuery.length > 1 && noQuery.endsWith("/")) {
    return noQuery.slice(0, -1);
  }
  return noQuery;
}

function normalizeRpcChannel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return `/${trimmed}`;
  const slash = trimmed.indexOf("/", 1);
  return slash > 0 ? trimmed.slice(0, slash) : trimmed;
}

export interface ClientHostSurface {
  readonly httpPaths: readonly string[];
  readonly rpcChannels: readonly string[];
}

export function scanClientHostSurface(pkgRoot: string): ClientHostSurface {
  const clientPath = path.join(pkgRoot, "client.js");
  if (!existsSync(clientPath)) {
    return { httpPaths: [], rpcChannels: [] };
  }
  let text: string;
  try {
    text = readFileSync(clientPath, "utf8");
  } catch {
    return { httpPaths: [], rpcChannels: [] };
  }

  const http = new Set<string>();
  const rpc = new Set<string>();

  for (const match of text.matchAll(QUOTED_PATH)) {
    const p = normalizeHttpPath(match[1]!);
    if (!p.startsWith("/")) continue;
    if (p.includes("-settings")) continue;
    http.add(p);
  }
  for (const match of text.matchAll(BACKTICK_PATH)) {
    const p = normalizeHttpPath(match[1]!);
    if (!p.startsWith("/")) continue;
    if (p.includes("-settings")) continue;
    http.add(p);
  }

  for (const match of text.matchAll(FETCH_PATH)) {
    const p = normalizeHttpPath(match[1]!);
    if (!p.startsWith("/")) continue;
    if (p.includes("-settings")) continue;
    http.add(p);
  }

  for (const match of text.matchAll(RPC_CHANNEL)) {
    const ch = normalizeRpcChannel(match[1]!);
    if (
      ch.endsWith("-settings") ||
      ch.startsWith("/dsh-") ||
      ch.startsWith("/vision-") ||
      ch === "/weixin" ||
      ch === "/dsh-pocket"
    ) {
      rpc.add(ch);
    }
  }
  for (const match of text.matchAll(RPC_LITERAL)) {
    const ch = normalizeRpcChannel(match[1]!);
    if (
      ch.endsWith("-settings") ||
      ch.startsWith("/dsh-") ||
      ch.startsWith("/vision-") ||
      ch === "/weixin" ||
      ch === "/dsh-pocket"
    ) {
      rpc.add(ch);
    }
  }

  return {
    httpPaths: [...http].sort(),
    rpcChannels: [...rpc].sort(),
  };
}
