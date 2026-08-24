/**
 * Infer Cordis-shaped Host routes for DSH community client packages that ship
 * no `xrk.host.json` / `dsh.host`. XRK-native `@xrkseek/*` plugins are excluded
 * unless they ship an explicit host manifest.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PluginHostManifest } from "./adapter-types.js";
import { scanClientHostSurface } from "./dsh-client-scan.js";
import {
  conventionRpcChannels,
  resolveRpcRoute,
} from "./dsh-path-capabilities.js";
import { shortPackageName } from "./dsh-package-names.js";

/** Best-effort Host manifest for DSH community client packages without explicit manifest. */
export function inferDshCommunityHostManifest(
  pkgRoot: string,
  packageName: string,
): PluginHostManifest {
  const id = packageName.replace(/^@/, "").replace(/\//g, "-");
  const scanned = scanClientHostSurface(pkgRoot);
  const rpcChannelNames = conventionRpcChannels(packageName, scanned.rpcChannels);

  const rpc = rpcChannelNames.map((channel) =>
    resolveRpcRoute(channel, packageName),
  );

  // HTTP: global capability table + honest GET catch-all; do not register per-package xrk-stub prefixes.

  return {
    id,
    ...(rpc.length ? { rpc } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function readStagedPackageJson(
  pkgRoot: string,
): Record<string, unknown> | undefined {
  const pkgPath = path.join(pkgRoot, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export { shortPackageName } from "./dsh-package-names.js";

/** Heuristic: npm package name looks like DSH community client. */
export function isDshCommunityPackageName(packageName: string): boolean {
  const trimmed = packageName.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("@xrkseek/")) return false;
  const short = shortPackageName(trimmed);
  if (short === "dshmarket" || short.startsWith("dsh-") || short.startsWith("vision-")) {
    return true;
  }
  if (trimmed.includes("/dsh-")) return true;
  return false;
}

export function isDshCommunityClientPackage(
  packageName: string,
  pkg?: Record<string, unknown>,
): boolean {
  if (pkg) {
    const xrkClient = asRecord(pkg.xrkseek)?.client;
    const dshClient = asRecord(pkg.dsh)?.client;
    if (xrkClient && !dshClient) return false;
    if (dshClient) return true;
  }
  return isDshCommunityPackageName(packageName);
}
