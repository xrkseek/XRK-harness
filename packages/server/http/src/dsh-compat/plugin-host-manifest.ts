/**
 * Parse plugin host manifest — explicit file first, then client scan + conventions.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  PluginHostHttpRoute,
  PluginHostManifest,
  PluginHostRpcRoute,
} from "./adapter-types.js";
import {
  inferDshCommunityHostManifest,
  isDshCommunityClientPackage,
  readStagedPackageJson,
} from "./dsh-community-infer.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function parseHttpRoute(raw: unknown): PluginHostHttpRoute | undefined {
  const o = asRecord(raw);
  if (!o || typeof o.prefix !== "string" || typeof o.provider !== "string") {
    return undefined;
  }
  const route: PluginHostHttpRoute = {
    prefix: o.prefix,
    provider: o.provider,
  };
  const options = asRecord(o.options);
  return options ? { ...route, options } : route;
}

function parseRpcRoute(raw: unknown): PluginHostRpcRoute | undefined {
  const o = asRecord(raw);
  if (!o || typeof o.channel !== "string" || typeof o.provider !== "string") {
    return undefined;
  }
  const route: PluginHostRpcRoute = {
    channel: o.channel,
    provider: o.provider,
  };
  const options = asRecord(o.options);
  return options ? { ...route, options } : route;
}

/** Normalize legacy `httpPrefixes` / `rpcChannels` into provider routes. */
export function normalizePluginHostManifest(
  raw: unknown,
  source: string,
): PluginHostManifest {
  const o = asRecord(raw);
  if (!o) {
    throw new Error(`${source}: expected host manifest object`);
  }
  const id = typeof o.id === "string" ? o.id.trim() : undefined;
  const incomplete =
    typeof o.incomplete === "string" ? o.incomplete.trim() : undefined;

  const http: PluginHostHttpRoute[] = [];
  for (const row of Array.isArray(o.http) ? o.http : []) {
    const parsed = parseHttpRoute(row);
    if (parsed) http.push(parsed);
  }
  for (const prefix of Array.isArray(o.httpPrefixes)
    ? o.httpPrefixes.filter((p): p is string => typeof p === "string")
    : []) {
    http.push({
      prefix,
      provider: "xrk-stub",
      options: {
        feature:
          id ??
          (prefix.replace(/\//g, "-").replace(/^-|-$/g, "") || "plugin"),
        ...(incomplete ? { incompleteTag: incomplete } : {}),
      },
    });
  }

  const rpc: PluginHostRpcRoute[] = [];
  for (const row of Array.isArray(o.rpc) ? o.rpc : []) {
    const parsed = parseRpcRoute(row);
    if (parsed) rpc.push(parsed);
  }
  for (const channel of Array.isArray(o.rpcChannels)
    ? o.rpcChannels.filter((c): c is string => typeof c === "string")
    : []) {
    rpc.push({
      channel,
      provider: "xrk-stub-rpc",
      options: { kind: "generic" },
    });
  }

  return {
    ...(id ? { id } : {}),
    ...(incomplete ? { incomplete } : {}),
    ...(http.length ? { http } : {}),
    ...(rpc.length ? { rpc } : {}),
  };
}

export function readPluginHostManifest(
  pkgRoot: string,
): PluginHostManifest | undefined {
  const jsonPath = path.join(pkgRoot, "xrk.host.json");
  if (existsSync(jsonPath)) {
    try {
      return normalizePluginHostManifest(
        JSON.parse(readFileSync(jsonPath, "utf8")),
        jsonPath,
      );
    } catch {
      return undefined;
    }
  }
  const pkgPath = path.join(pkgRoot, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<
      string,
      unknown
    >;
    const nested =
      asRecord(pkg.xrkseek)?.host ??
      asRecord(pkg.dsh)?.host ??
      pkg["dsh.host"];
    if (!nested) return undefined;
    return normalizePluginHostManifest(nested, pkgPath);
  } catch {
    return undefined;
  }
}

/**
 * Resolve Host manifest for an installed client package.
 * 1. `xrk.host.json` / staged `package.json` host fields
 * 2. `client.js` scan + Cordis naming conventions (DSH community client only)
 *
 * Standard HTTP paths (`/api/wallet/`, `/sidebar/`, …) are mounted globally
 * via `dsh-path-capabilities` — not repeated per package.
 */
export function resolvePluginHostManifest(
  pkgRoot: string,
  packageName: string,
): PluginHostManifest | undefined {
  const explicit = readPluginHostManifest(pkgRoot);
  if (explicit) return explicit;
  const pkg = readStagedPackageJson(pkgRoot);
  if (!isDshCommunityClientPackage(packageName, pkg)) return undefined;
  return inferDshCommunityHostManifest(pkgRoot, packageName);
}

export function clientPluginRoot(
  pluginsDir: string,
  packageName: string,
): string {
  return path.join(pluginsDir, "web", "plugins", ...packageName.split("/"));
}
