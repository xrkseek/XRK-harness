/**
 * Resolve the Vercel Labs `agent-browser` CLI binary.
 * Precedence: env → native binary under host/cwd node_modules → PATH name.
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
    `${binName}-linux-musl-x64`,
    `${binName}-linux-musl-arm64`,
  ];
}

function pushPackageBins(out: string[], packageRoot: string, binName: string): void {
  const binDir = path.join(packageRoot, "bin");
  for (const name of nativeNames(binName)) {
    out.push(path.join(binDir, name));
  }
  out.push(
    path.join(binDir, binName),
    path.join(binDir, `${binName}.exe`),
    path.join(binDir, `${binName}.js`),
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
  // Dedupe while preserving order.
  return [...new Set(roots.map((r) => path.normalize(r)))];
}

function candidates(binName: string): string[] {
  const out: string[] = [];
  const packageName = "agent-browser";
  const resourcesPath = (process as NodeJS.Process & {
    resourcesPath?: string;
  }).resourcesPath;
  const resources = typeof resourcesPath === "string" ? resourcesPath : "";
  if (resources) {
    const hostMods = path.join(resources, "host", "node_modules");
    out.push(
      path.join(hostMods, ".bin", binName),
      path.join(hostMods, ".bin", `${binName}.cmd`),
    );
    pushPackageBins(out, path.join(hostMods, packageName), binName);
  }
  for (const root of searchRoots()) {
    const mods = path.join(root, "node_modules");
    // Prefer native package bins over .bin shims (Windows cannot spawn
    // extensionless npm shims without a shell).
    pushPackageBins(out, path.join(mods, packageName), binName);
    out.push(
      path.join(mods, ".bin", `${binName}.cmd`),
      path.join(mods, ".bin", `${binName}.exe`),
      path.join(mods, ".bin", binName),
    );
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
    // not installed beside this module
  }
  return out;
}

/**
 * @param env - process env (tests inject).
 * @returns absolute path or bare `agent-browser` for PATH lookup.
 */
export function resolveAgentBrowserBin(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = String(env.XRK_AGENT_BROWSER ?? "").trim();
  if (override) return override;
  for (const candidate of candidates("agent-browser")) {
    if (isPresent(candidate)) return candidate;
  }
  return "agent-browser";
}
