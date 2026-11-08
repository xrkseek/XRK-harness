/**
 * Resolve a CLI binary for computer-use backends (agent-desktop).
 * Precedence: env override → native binary under host/cwd node_modules → PATH name.
 *
 * Does **not** mutate PATH. Host shells already see system CLIs (node / npm);
 * product `xrkh` on the user PATH is Settings → General (Desktop). The
 * computer_use Provider spawns via the absolute path (or `XRK_AGENT_DESKTOP`).
 */

import { execFileSync } from "node:child_process";
import {
  accessSync,
  constants as fsConstants,
  mkdirSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

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
 * Default state root for agent-desktop (all platforms).
 *
 * - Windows: `%LOCALAPPDATA%/xrk-harness-agent-desktop`
 * - macOS / Linux: `$XDG_DATA_HOME/xrk-harness-agent-desktop` or
 *   `~/.local/share/xrk-harness-agent-desktop`
 *
 * Avoid nesting under `{XRK_HOME}` — elevated Windows runs often leave
 * `~/.xrk` owned by Administrators, which fails agent-desktop's private-file
 * parent check for a normal (medium IL) Host. Explicit `AGENT_DESKTOP_HOME`
 * still wins.
 */
export function resolveAgentDesktopHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = String(env.AGENT_DESKTOP_HOME ?? "").trim();
  if (override) return path.resolve(override);
  if (process.platform === "win32") {
    const localAppData =
      String(env.LOCALAPPDATA ?? "").trim() ||
      path.join(os.homedir(), "AppData", "Local");
    return path.join(path.resolve(localAppData), "xrk-harness-agent-desktop");
  }
  const xdg =
    String(env.XDG_DATA_HOME ?? "").trim() ||
    path.join(os.homedir(), ".local", "share");
  return path.join(path.resolve(xdg), "xrk-harness-agent-desktop");
}

/**
 * Best-effort wipe of the Windows interaction lease under ProgramData.
 * Elevated Cursor leaves the lease owned by Administrators; a medium-IL
 * Harness then fails focus/act. Non-elevated processes often cannot delete
 * it — surface via CLI; this clears when allowed.
 */
export function clearWindowsAgentDesktopLease(): void {
  if (process.platform !== "win32") return;
  const root = path.join(
    process.env.ProgramData?.trim() || "C:\\ProgramData",
    "agent-desktop",
  );
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // Access denied when elevated pollution remains — surface via CLI.
  }
}

/** Windows High integrity (Run as administrator / elevated Cursor helper). */
export function isWindowsProcessElevated(): boolean {
  if (process.platform !== "win32") return false;
  try {
    const out = execFileSync("whoami.exe", ["/groups"], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });
    return /High Mandatory Level/i.test(out);
  } catch {
    return false;
  }
}

/** True when Windows ACL owner is Administrators / SYSTEM (elevated pollution). */
export function isElevatedOwnedWindowsPath(target: string): boolean {
  if (process.platform !== "win32") return false;
  try {
    // `dir /q` prints owner on the `.` row — no PowerShell Security module needed.
    const out = execFileSync("cmd.exe", ["/c", "dir", "/q", target], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });
    const row = out
      .split(/\r?\n/)
      .find((line) => /<DIR>\s+\S+.*\.\s*$/.test(line));
    const m = row?.match(/<DIR>\s+(\S+)\s+\.\s*$/);
    const owner = m?.[1] ?? "";
    return /(\\Administrators|\\SYSTEM)$/i.test(owner);
  } catch {
    return false;
  }
}

/**
 * Ensure `preferred` is usable as AGENT_DESKTOP_HOME.
 *
 * - Non-Windows: mkdir and return preferred.
 * - Elevated Windows Host: Administrators ownership is expected — keep preferred.
 * - Medium-IL Windows Host + Administrators-owned preferred (pollution from an
 *   elevated tool): relocate to a fresh sibling created by this process.
 */
export function ensureWritableAgentDesktopHome(preferred: string): string {
  try {
    mkdirSync(preferred, { recursive: true });
  } catch {
    // fall through — may relocate on win32
  }
  if (process.platform !== "win32") return preferred;
  // Elevated process: Admin-owned state root matches the token — do not relocate
  // (relocating while elevated would just create another Admin-owned folder).
  if (isWindowsProcessElevated()) return preferred;
  if (!isElevatedOwnedWindowsPath(preferred)) return preferred;
  try {
    rmSync(preferred, { recursive: true, force: true });
  } catch {
    /* may lack delete rights */
  }
  const relocated = `${preferred}-${randomBytes(4).toString("hex")}`;
  try {
    mkdirSync(relocated, { recursive: true });
  } catch {
    /* CLI still gets the path */
  }
  return relocated;
}

/**
 * Pin `XRK_AGENT_DESKTOP` (absolute binary) and `AGENT_DESKTOP_HOME`
 * on this env object. Also best-effort clears a polluted ProgramData lease.
 * Does not mutate PATH (Host terminals already see node/npm; product `xrkh`
 * PATH is Settings → General on Desktop).
 */
export function pinAgentDesktopEnv(
  env: NodeJS.ProcessEnv = process.env,
): string {
  clearWindowsAgentDesktopLease();
  const bin = resolveAgentDesktopBin(env);
  if (bin !== "agent-desktop" && path.isAbsolute(bin)) {
    if (!env.XRK_AGENT_DESKTOP?.trim()) {
      env.XRK_AGENT_DESKTOP = bin;
    }
  }
  if (!String(env.AGENT_DESKTOP_HOME ?? "").trim()) {
    const preferred = resolveAgentDesktopHome(env);
    env.AGENT_DESKTOP_HOME = ensureWritableAgentDesktopHome(preferred);
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
