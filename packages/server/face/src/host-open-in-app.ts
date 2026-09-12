/**
 * host.listOpenInApps / host.openInApp — probe a small catalog of editors,
 * terminals, and file managers, then launch the session workspace directory.
 * Shape audit vs DSH open-in-app (Face RPC, not /open-in-app HTTP routes).
 */

import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  canOpenNativePath,
  normalizeOpenPath,
  openNativePath,
  spawnDetached,
  windowsExplorerPath,
} from "./host-open-path.js";
import { fullyQualified } from "./host-directory.js";
import type { FaceRpcResult } from "./types.js";

/** Catalog ids the Web header may name (dictionaries gate display). */
export type OpenInAppId =
  | "finder"
  | "explorer"
  | "filemanager"
  | "cursor"
  | "vscode"
  | "terminal"
  | "windowsterminal"
  | "iterm"
  | "gnometerminal";

type LaunchKind = "shell-open" | "argv";

interface CatalogEntry {
  readonly id: OpenInAppId;
  readonly platforms: readonly NodeJS.Platform[];
  readonly kind: LaunchKind;
  /** Absolute launcher paths or `.app` bundles to probe (any hit = installed). */
  readonly probePaths?: readonly string[];
  /** PATH executable names (win PATHEXT / posix which-style). */
  readonly probeBins?: readonly string[];
  readonly argv?: readonly string[];
  /**
   * Hide the spawned process window on Windows. Default true for CLI stubs
   * (`cursor` / `code`) whose GUI is another process. False for console hosts
   * that own the visible window (`wt`).
   */
  readonly windowsHide?: boolean;
}

interface ResolvedLaunch {
  readonly command: string;
  readonly args: string[];
  readonly windowsHide: boolean;
}

/** Store / App Execution Alias stubs under WindowsApps (0-byte reparse points). */
export function isWindowsAppsAliasPath(path: string): boolean {
  return /[\\/]WindowsApps[\\/]/i.test(path);
}

/** SSH / remote-forward markers: hide Open In (same decision as DSH host package). */
export function isSshLaunchEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SSH_CONNECTION || env.SSH_TTY);
}

function pathExists(path: string): boolean {
  try {
    accessSync(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function binOnPath(name: string, platform: NodeJS.Platform): boolean {
  const pathEnv = process.env.PATH ?? process.env.Path ?? "";
  const sep = platform === "win32" ? ";" : ":";
  const exts =
    platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, platform === "win32" ? `${name}${ext}` : name);
      if (pathExists(candidate)) return true;
    }
    if (platform !== "win32" && pathExists(join(dir, name))) return true;
  }
  return false;
}

/** First existing probe path that is not a WindowsApps execution alias. */
function firstRealProbePath(
  paths: readonly string[] | undefined,
): string | undefined {
  return (paths ?? []).find((p) => pathExists(p) && !isWindowsAppsAliasPath(p));
}

function homeApplications(...names: string[]): string[] {
  const home = homedir();
  return names.flatMap((n) => [
    join("/Applications", n),
    join(home, "Applications", n),
  ]);
}

function winLocalAppData(...parts: string[]): string {
  const base = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  return join(base, ...parts);
}

function winProgramFiles(...parts: string[]): string[] {
  const roots = [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    "C:\\Program Files",
    "C:\\Program Files (x86)",
  ].filter((x): x is string => Boolean(x));
  return roots.map((root) => join(root, ...parts));
}

/** Fixed whitelist — verified launchers only (no disk-wide scan). */
export function openInAppCatalog(
  platform: NodeJS.Platform = process.platform,
): readonly CatalogEntry[] {
  const all: CatalogEntry[] = [
    {
      id: "finder",
      platforms: ["darwin"],
      kind: "shell-open",
    },
    {
      id: "explorer",
      platforms: ["win32"],
      kind: "shell-open",
    },
    {
      id: "filemanager",
      platforms: ["linux"],
      kind: "shell-open",
    },
    {
      id: "cursor",
      platforms: ["darwin", "win32", "linux"],
      kind: "argv",
      probePaths: [
        ...homeApplications("Cursor.app"),
        winLocalAppData("Programs", "cursor", "Cursor.exe"),
        ...winProgramFiles("Cursor", "Cursor.exe"),
        "/usr/share/cursor/cursor",
        join(homedir(), ".local", "bin", "cursor"),
      ],
      probeBins: ["cursor"],
      argv:
        platform === "darwin"
          ? ["open", "-a", "Cursor", "{path}"]
          : ["cursor", "{path}"],
    },
    {
      id: "vscode",
      platforms: ["darwin", "win32", "linux"],
      kind: "argv",
      probePaths: [
        ...homeApplications("Visual Studio Code.app"),
        ...winProgramFiles("Microsoft VS Code", "Code.exe"),
        winLocalAppData("Programs", "Microsoft VS Code", "Code.exe"),
        "/usr/share/code/code",
        "/usr/bin/code",
      ],
      probeBins: ["code"],
      argv:
        platform === "darwin"
          ? ["open", "-a", "Visual Studio Code", "{path}"]
          : ["code", "{path}"],
    },
    {
      id: "terminal",
      platforms: ["darwin"],
      kind: "argv",
      probePaths: [
        "/System/Applications/Utilities/Terminal.app",
        "/Applications/Utilities/Terminal.app",
      ],
      argv: ["open", "-a", "Terminal", "{path}"],
      windowsHide: false,
    },
    {
      id: "iterm",
      platforms: ["darwin"],
      kind: "argv",
      probePaths: homeApplications("iTerm.app"),
      argv: ["open", "-a", "iTerm", "{path}"],
      windowsHide: false,
    },
    {
      id: "windowsterminal",
      platforms: ["win32"],
      kind: "argv",
      // Probe may hit the WindowsApps alias; launch never uses that path.
      probePaths: [
        winLocalAppData("Microsoft", "WindowsApps", "wt.exe"),
        ...winProgramFiles("Windows Terminal", "wt.exe"),
      ],
      probeBins: ["wt"],
      argv: ["wt", "-d", "{path}"],
      windowsHide: false,
    },
    {
      id: "gnometerminal",
      platforms: ["linux"],
      kind: "argv",
      probeBins: ["gnome-terminal"],
      argv: ["gnome-terminal", `--working-directory={path}`],
      windowsHide: false,
    },
  ];
  return all.filter((e) => e.platforms.includes(platform));
}

function entryInstalled(
  entry: CatalogEntry,
  platform: NodeJS.Platform,
): boolean {
  if (entry.kind === "shell-open") return true;
  // WindowsApps aliases exist as 0-byte stubs; listing them would offer an
  // app whose CreateProcess path we refuse at launch.
  if (firstRealProbePath(entry.probePaths) !== undefined) return true;
  for (const bin of entry.probeBins ?? []) {
    if (binOnPath(bin, platform)) return true;
  }
  return false;
}

function resolveArgvCommand(
  entry: CatalogEntry,
  platform: NodeJS.Platform,
  workspace: string,
): ResolvedLaunch | undefined {
  const template = entry.argv;
  if (template === undefined || template.length === 0) return undefined;
  const parts = template.map((t) => t.split("{path}").join(workspace));
  const windowsHide = entry.windowsHide !== false;

  if (platform === "darwin" && parts[0] === "open") {
    return { command: "open", args: parts.slice(1), windowsHide };
  }

  if (platform === "win32" && entry.id === "windowsterminal") {
    // Never CreateProcess the 0-byte WindowsApps alias path. Prefer PATH name
    // `wt` (system resolves the alias) or an unpackaged Program Files install.
    const unpackaged = firstRealProbePath(entry.probePaths);
    const wt = binOnPath("wt", platform) ? "wt" : unpackaged;
    if (wt === undefined) return undefined;
    // No `-w new`: reuse existing window/tab instead of stacking windows.
    return {
      command: wt,
      args: ["-d", workspace],
      windowsHide: false,
    };
  }

  if (entry.id === "cursor" || entry.id === "vscode") {
    const bin = entry.probeBins?.[0];
    const fromPath = bin && binOnPath(bin, platform) ? bin : undefined;
    const fromFile = firstRealProbePath(entry.probePaths);
    // Win: prefer real .exe over PATH shim (`.cmd` / Apps alias) — shims fail
    // under integrity mismatch (e.g. Host Medium, Cursor elevated).
    const command =
      platform === "win32"
        ? (fromFile ?? fromPath)
        : (fromPath ?? fromFile);
    if (command === undefined) return undefined;
    if (platform === "darwin" && parts[0] === "open") {
      return { command: "open", args: parts.slice(1), windowsHide };
    }
    return { command, args: parts.slice(1), windowsHide };
  }

  return { command: parts[0]!, args: parts.slice(1), windowsHide };
}

let cachedApps: readonly OpenInAppId[] | undefined;

/** Test hook: drop the once-per-process probe cache. */
export function resetOpenInAppCache(): void {
  cachedApps = undefined;
}

/**
 * Probe installed catalog apps (once per process). Empty when native open is
 * unavailable or the Host launched under SSH.
 */
export function listInstalledOpenInApps(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): readonly OpenInAppId[] {
  if (cachedApps !== undefined) return cachedApps;
  if (!canOpenNativePath(platform, env) || isSshLaunchEnv(env)) {
    cachedApps = [];
    return cachedApps;
  }
  const apps = openInAppCatalog(platform)
    .filter((e) => entryInstalled(e, platform))
    .map((e) => e.id);
  cachedApps = apps;
  return cachedApps;
}

export async function launchOpenInApp(
  appId: string,
  workspacePath: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!canOpenNativePath(platform, env) || isSshLaunchEnv(env)) {
    throw new Error("open-in-app unavailable");
  }
  const entry = openInAppCatalog(platform).find((e) => e.id === appId);
  if (entry === undefined || !entryInstalled(entry, platform)) {
    throw new Error(`app not available: ${appId}`);
  }
  if (entry.kind === "shell-open") {
    await openNativePath(workspacePath, platform);
    return;
  }
  const resolved = resolveArgvCommand(entry, platform, workspacePath);
  if (resolved === undefined) throw new Error(`app launcher missing: ${appId}`);
  await spawnDetached(resolved.command, resolved.args, {
    windowsHide: resolved.windowsHide,
  });
}

/**
 * Test seam: resolve argv for one catalog id without spawning.
 */
export function resolveOpenInAppArgv(
  appId: string,
  workspacePath: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: readonly string[]; windowsHide: boolean } | undefined {
  const entry = openInAppCatalog(platform).find((e) => e.id === appId);
  if (entry === undefined || entry.kind !== "argv") return undefined;
  if (!entryInstalled(entry, platform)) return undefined;
  return resolveArgvCommand(entry, platform, workspacePath);
}

export async function hostListOpenInApps(): Promise<
  FaceRpcResult<{ apps: readonly string[] }>
> {
  return { ok: true, value: { apps: [...listInstalledOpenInApps()] } };
}

export async function hostOpenInApp(
  payload: unknown,
): Promise<FaceRpcResult<{ opened: true }>> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "app and path required" },
    };
  }
  const body = payload as Record<string, unknown>;
  const app = String(body.app ?? "").trim();
  const rawPath = String(body.path ?? "").trim();
  if (!app || !rawPath) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "app and path required" },
    };
  }
  const path =
    process.platform === "win32"
      ? windowsExplorerPath(rawPath)
      : normalizeOpenPath(rawPath);
  if (!fullyQualified(path)) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "path must be absolute" },
    };
  }
  if (!existsSync(path)) {
    return {
      ok: false,
      error: { code: "not-found", message: `path not found: ${path}` },
    };
  }
  try {
    if (!statSync(path).isDirectory()) {
      return {
        ok: false,
        error: {
          code: "invalid-payload",
          message: "path must be a directory",
        },
      };
    }
  } catch {
    return {
      ok: false,
      error: { code: "not-found", message: `path not found: ${path}` },
    };
  }
  try {
    await launchOpenInApp(app, path);
    return { ok: true, value: { opened: true } };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "internal",
        message: `open-in-app failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}
