/**
 * User-data home for XRK-Harness (DSH `~/.dsh` posture).
 *
 * Precedence: `XRK_HOME` / `XRK_DSH_HOME` / `DSH_HOME` → `~/.xrk`.
 * Tests pin `XRK_HOME` so they never write the real user profile.
 */
import { homedir } from "node:os";
import path from "node:path";

/** Directory name under the OS home. */
export const XRK_HOME_DIR_NAME = ".xrk";

/** Env vars that override the default home (first non-empty wins). */
export const XRK_HOME_ENVS = ["XRK_HOME", "XRK_DSH_HOME", "DSH_HOME"] as const;

/** Default `~/.xrk`. */
export function defaultXrkHome(): string {
  return path.join(homedir(), XRK_HOME_DIR_NAME);
}

function expandHomePath(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(homedir(), value.slice(2));
  }
  return value;
}

/** Resolve the single-root harness home. Empty env is treated as unset. */
export function resolveXrkHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  for (const key of XRK_HOME_ENVS) {
    const raw = env[key]?.trim();
    if (raw) return path.resolve(expandHomePath(raw));
  }
  return path.resolve(defaultXrkHome());
}

/** `{home}/sessions` — CLI persist default when `XRK_SESSIONS_DIR` is unset. */
export function defaultSessionsDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveXrkHome(env), "sessions");
}

/** `{home}/host-settings.json` — Face MCP desired-servers dump. */
export function hostSettingsPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveXrkHome(env), "host-settings.json");
}

/**
 * `{home}/plugins` — CLI `plugin add` root + optional Host `pluginsDir`.
 * Process discover + `{plugins}/web/` client overlay live here.
 */
export function defaultPluginsDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveXrkHome(env), "plugins");
}
