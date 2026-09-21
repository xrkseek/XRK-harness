/**
 * Global product-data home for workspace inject / home skills.
 * Leaf packages must not hand-roll `homedir()` + `.xrk` or `XRK_HOME`.
 */
import path from "node:path";
import {
  XRK_HOME_DIR_NAME,
  resolveXrkHome,
  xrkHomeDisplay,
} from "@xrkseek/xrk-home-paths";

/**
 * Resolve the global product home used for standing inject and home skills.
 *
 * - Test override `homeDir` → `{homeDir}/.xrk` (isolated fake OS home).
 * - Otherwise {@link resolveXrkHome} (`XRK_HOME` / `XRK_DSH_HOME` / `DSH_HOME` / `~/.xrk`).
 */
export function resolveUserProductHome(homeDir?: string): string {
  const override = homeDir?.trim();
  if (override) {
    return path.resolve(
      path.join(path.resolve(override), XRK_HOME_DIR_NAME),
    );
  }
  return resolveXrkHome();
}

/**
 * Logical section prefix for home product standing
 * (`~/.xrk/` or `$XRK_HOME/`). Test `homeDir` always displays as `~/.xrk/`.
 */
export function userProductHomeLogicalPrefix(homeDir?: string): string {
  if (homeDir?.trim()) {
    return `~/${XRK_HOME_DIR_NAME}/`;
  }
  return `${xrkHomeDisplay(resolveUserProductHome())}/`;
}

/**
 * Map a `~/.xrk/...` relative path onto {@link resolveUserProductHome}.
 * Non-`.xrk` paths are returned unchanged for the caller to join onto OS home.
 */
export function resolveUnderUserProductHome(
  rel: string,
  homeDir?: string,
): string | undefined {
  const normalized = rel.replace(/\\/g, "/");
  if (normalized === ".xrk" || normalized === XRK_HOME_DIR_NAME) {
    return resolveUserProductHome(homeDir);
  }
  const prefix = `${XRK_HOME_DIR_NAME}/`;
  if (normalized.startsWith(prefix)) {
    return path.join(
      resolveUserProductHome(homeDir),
      ...normalized.slice(prefix.length).split("/").filter(Boolean),
    );
  }
  return undefined;
}
