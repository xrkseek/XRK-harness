/**
 * Load platform-local Desktop release dotenv (ADR-0008).
 * Pattern from dsh `desktop-package-environment.mjs`: file-owned settings, no ambient leak of secrets.
 */

import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { resolveDesktopAppRoot } from "./build-paths.js";

const SHARED_SETTING =
  /^(?:XRK_DESKTOP_(?:UNSIGNED|AUTO_UPDATE_ENV|UPDATE_(?:TEST_)?ORIGIN|UPLOAD_(?:TEST_)?(?:BUCKET|SECRET_ID|SECRET_KEY)))$/u;
const WINDOWS_SETTING =
  /^XRK_DESKTOP_WINDOWS_(?:CER_FILE|SIGNTOOL|KEY_CONTAINER|TOKEN_PIN)$/u;
const MACOS_SETTING =
  /^XRK_DESKTOP_MACOS_(?:IDENTITY|APPLE_ID|APPLE_ID_PASSWORD|TEAM_ID)$/u;
/** Secrets / feed / upload — stripped from ambient when a dotenv file owns the release surface. */
const AMBIENT_RELEASE_SETTING =
  /^(?:XRK_DESKTOP_(?:AUTO_UPDATE_ENV|UPDATE_.*|UPLOAD_.*|WINDOWS_.*|MACOS_.*)|(?:WIN_)?CSC_.*)$/iu;
/** Packaging mode flag — not a secret; ambient CLI (`XRK_DESKTOP_UNSIGNED=1`) wins over the file. */
const DESKTOP_UNSIGNED_ENV = "XRK_DESKTOP_UNSIGNED";
const FILE_SETTINGS = [
  "XRK_DESKTOP_WINDOWS_CER_FILE",
  "XRK_DESKTOP_WINDOWS_SIGNTOOL",
] as const;

export type DesktopPackageEnvPlatform = "win32" | "darwin";

/** Absolute path of the platform dotenv under apps/desktop. */
export function desktopPackageEnvironmentPath(
  platform: DesktopPackageEnvPlatform,
  appRoot: string = resolveDesktopAppRoot(),
): string {
  return join(
    appRoot,
    platform === "win32" ? ".env.windows" : ".env.macos",
  );
}

/**
 * Read `.env.windows` / `.env.macos` when present.
 * Missing file → `undefined` (callers keep ambient env / unsigned path).
 */
export function tryLoadDesktopPackageEnvironment(
  platform: DesktopPackageEnvPlatform,
  environment: NodeJS.ProcessEnv = process.env,
  appRoot: string = resolveDesktopAppRoot(),
): NodeJS.ProcessEnv | undefined {
  const path = desktopPackageEnvironmentPath(platform, appRoot);
  if (!existsSync(path)) return undefined;
  return loadDesktopPackageEnvironment(platform, environment, appRoot);
}

/**
 * Read the required UTF-8 dotenv; release settings never fall back to ambient XRK_DESKTOP_* values.
 */
export function loadDesktopPackageEnvironment(
  platform: DesktopPackageEnvPlatform,
  environment: NodeJS.ProcessEnv = process.env,
  appRoot: string = resolveDesktopAppRoot(),
): NodeJS.ProcessEnv {
  const path = desktopPackageEnvironmentPath(platform, appRoot);
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `xrk desktop: cannot read ${path}; copy ${path}.example and fill local settings`,
    );
  }
  let settings: NodeJS.ProcessEnv;
  try {
    settings = parseEnv(contents.replace(/^\uFEFF/u, ""));
  } catch {
    throw new Error(`xrk desktop: invalid dotenv syntax in ${path}`);
  }
  const platformSetting = platform === "win32" ? WINDOWS_SETTING : MACOS_SETTING;
  for (const name of Object.keys(settings)) {
    if (!SHARED_SETTING.test(name) && !platformSetting.test(name)) {
      throw new Error(
        `xrk desktop: unsupported setting ${name} in ${path}; use the platform template`,
      );
    }
    const value = settings[name];
    if (typeof value === "string" && value.includes("\0")) {
      throw new Error(`xrk desktop: ${name} cannot contain a NUL character`);
    }
  }
  for (const name of FILE_SETTINGS) {
    const raw = settings[name]?.trim();
    if (raw) settings[name] = resolve(dirname(path), raw);
  }
  const ambientUnsigned = environment[DESKTOP_UNSIGNED_ENV];
  const merged: NodeJS.ProcessEnv = {
    ...Object.fromEntries(
      Object.entries(environment).filter(
        ([name]) => !AMBIENT_RELEASE_SETTING.test(name),
      ),
    ),
    ...settings,
  };
  // CLI / CI packaging mode overrides the file (UNSIGNED is not a secret).
  if (ambientUnsigned !== undefined && String(ambientUnsigned).trim() !== "") {
    merged[DESKTOP_UNSIGNED_ENV] = ambientUnsigned;
  }
  return merged;
}

/** Ensure CER / SignTool paths point at readable files when set. */
export function assertDesktopPackageSigningFiles(
  environment: NodeJS.ProcessEnv,
): void {
  for (const name of FILE_SETTINGS) {
    const value = environment[name]?.trim();
    if (!value) continue;
    try {
      if (!statSync(value).isFile()) throw new Error("not a file");
      accessSync(value, constants.R_OK);
    } catch {
      throw new Error(
        `xrk desktop: ${name} must identify a readable local file (${value})`,
      );
    }
  }
}
