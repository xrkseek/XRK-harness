/**
 * Resolve a CLI binary for computer-use backends (agent-desktop).
 * Precedence: env override → native binary under host/cwd node_modules → PATH name.
 *
 * Does **not** mutate PATH. Host shells already see system CLIs (node / npm);
 * product `xrkh` on the user PATH is Settings → General (Desktop). The
 * computer_use Provider spawns via the absolute path (or `XRK_AGENT_DESKTOP`).
 */

import { accessSync, constants as fsConstants } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

function isPresent(candidate: string): boolean {
  try {
    accessSync(candidate, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Windows `execFile` cannot spawn extensionless npm shims (need cmd.exe).
 * Prefer native `.exe`, then `.cmd`; skip bare shim names on win32.
 */
function isSpawnableCandidate(candidate: string): boolean {
  if (!isPresent(candidate)) return false;
  if (process.platform !== "win32") return true;
  const base = path.basename(candidate).toLowerCase();
  if (base.endsWith(".exe") || base.endsWith(".cmd") || base.endsWith(".bat")) {
    return true;
  }
  // Extensionless file under node_modules/.bin is a node shim — not spawnable.
  if (base === "agent-desktop" || !path.extname(base)) {
    return false;
  }
  return true;
}

/** Platform-native binary filenames shipped by the npm postinstall. */
function nativeNames(binName: string): string[] {
  const { platform, arch } = process;
  if (platform === "win32") {
    return [
      `${binName}-win32-${arch}.exe`,
      `${binName}-win32-x64.exe`,
      `${binName}-win32-arm64.exe`,
    ];
  }
  if (platform === "darwin") {
    return [
      `${binName}-darwin-${arch}`,
      `${binName}-darwin-arm64`,
      `${binName}-darwin-x64`,
    ];
  }
  return [
    `${binName}-linux-${arch}`,
    `${binName}-linux-x64`,
    `${binName}-linux-arm64`,
  ];
}

function pushPackageBins(
  out: string[],
  packageRoot: string,
  binName: string,
): void {
  const binDir = path.join(packageRoot, "bin");
  for (const name of nativeNames(binName)) {
    out.push(path.join(binDir, name));
  }
  out.push(
    path.join(binDir, `${binName}.exe`),
    path.join(binDir, binName),
    path.join(binDir, `${binName}.js`),
  );
}

function pushShimBins(out: string[], mods: string, binName: string): void {
  out.push(
    path.join(mods, ".bin", `${binName}.cmd`),
    path.join(mods, ".bin", `${binName}.exe`),
    path.join(mods, ".bin", binName),
  );
}

/** Monorepo / Desktop Host roots that ship the CLI under node_modules. */
function searchRoots(): string[] {
  const cwd = process.cwd();
  const roots = [
    cwd,
    path.resolve(cwd, ".."),
    path.join(cwd, "apps", "desktop-host"),
    path.resolve(cwd, "..", "apps", "desktop-host"),
    path.join(cwd, "desktop-host"),
  ];
  return [...new Set(roots.map((r) => path.normalize(r)))];
}

function binCandidates(packageName: string, binName: string): string[] {
  const out: string[] = [];
  const resourcesPath = (process as NodeJS.Process & {
    resourcesPath?: string;
  }).resourcesPath;
  const resources = typeof resourcesPath === "string" ? resourcesPath : "";
  if (resources) {
    const hostMods = path.join(resources, "host", "node_modules");
    // Native package bins BEFORE .bin shims (Windows cannot execFile shims).
    pushPackageBins(out, path.join(hostMods, packageName), binName);
    pushShimBins(out, hostMods, binName);
  }
  // Desktop Host / monorepo cwd deploy (incl. apps/desktop-host under repo root)
  for (const root of searchRoots()) {
    const mods = path.join(root, "node_modules");
    pushPackageBins(out, path.join(mods, packageName), binName);
    pushShimBins(out, mods, binName);
  }
  for (const pkgJsonPath of [
    path.join(process.cwd(), "package.json"),
    path.join(process.cwd(), "apps", "desktop-host", "package.json"),
  ]) {
    try {
      const req = createRequire(pkgJsonPath);
      const pkgJson = req.resolve(`${packageName}/package.json`);
      pushPackageBins(out, path.dirname(pkgJson), binName);
    } catch {
      // package not reachable from this package.json
    }
  }
  try {
    const req = createRequire(import.meta.url);
    const pkgJson = req.resolve(`${packageName}/package.json`);
    pushPackageBins(out, path.dirname(pkgJson), binName);
  } catch {
    // package not installed next to this module
  }
  return out;
}

/**
 * Resolve `agent-desktop` (or another CLI) for spawning.
 * @param env - process env (tests inject).
 * @param envKey - override env var (default `XRK_AGENT_DESKTOP`).
 * @returns absolute path or bare command name for PATH lookup.
 */
export function resolveAgentDesktopBin(
  env: NodeJS.ProcessEnv = process.env,
  envKey = "XRK_AGENT_DESKTOP",
): string {
  const override = String(env[envKey] ?? "").trim();
  if (override) return override;
  for (const candidate of binCandidates("agent-desktop", "agent-desktop")) {
    if (isSpawnableCandidate(candidate)) return candidate;
  }
  return "agent-desktop";
}

/**
 * Pin `XRK_AGENT_DESKTOP` to the resolved absolute binary for this env object.
 * Does not mutate PATH (Host terminals already see node/npm; product `xrkh`
 * PATH is Settings → General on Desktop).
 */
export function pinAgentDesktopEnv(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const bin = resolveAgentDesktopBin(env);
  if (bin === "agent-desktop" || !path.isAbsolute(bin)) return bin;
  if (!env.XRK_AGENT_DESKTOP?.trim()) {
    env.XRK_AGENT_DESKTOP = bin;
  }
  return bin;
}

/**
 * @deprecated Use {@link pinAgentDesktopEnv}. Kept as an alias — no PATH inject.
 */
export function ensureAgentDesktopOnPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return pinAgentDesktopEnv(env);
}
