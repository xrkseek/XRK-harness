/**
 * Desktop first-paint appearance: read durable ui-theme preference before Host
 * is up, so the static splash + BrowserWindow floor match Settings (not a
 * hard-coded light gray).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Light splash / window floor — matches AppRoot light fallback. */
export const DESKTOP_SPLASH_BG_LIGHT = "#f4f4f5" as const;

/** Dark splash / window floor — `--dsw-static-neutral-bluish-950`. */
export const DESKTOP_SPLASH_BG_DARK = "#151517" as const;

export type DesktopThemePreference = "light" | "dark" | "system";
export type DesktopColorScheme = "light" | "dark";

/**
 * Best-effort parse of `ui-theme.preference` from `$XRK_HOME/settings.yaml`
 * without pulling js-yaml into the private Desktop package.
 */
export function readThemePreferenceFromSettingsYaml(
  text: string,
): DesktopThemePreference | undefined {
  const block = /(?:^|\n)ui-theme:\s*\n((?:[ \t]+[^\n]*\n?)*)/u.exec(text);
  if (block === null) return undefined;
  const pref = /(?:^|\n)[ \t]+preference:\s*(dark|light|system)\b/u.exec(
    block[1] ?? "",
  );
  if (pref === null) return undefined;
  return pref[1] as DesktopThemePreference;
}

/** Fallback from redacted `host-settings.json` (`ui.theme`). */
export function readThemePreferenceFromHostSettingsJson(
  text: string,
): DesktopThemePreference | undefined {
  try {
    const parsed = JSON.parse(text) as {
      ui?: { theme?: unknown };
    };
    const theme = parsed.ui?.theme;
    if (theme === "dark" || theme === "light" || theme === "system") {
      return theme;
    }
  } catch {
    /* ignore malformed */
  }
  return undefined;
}

/**
 * Resolve durable theme preference from Harness home (settings.yaml first,
 * then host-settings.json). Defaults to `system` when neither is present.
 */
export function resolveDesktopThemePreference(
  xrkHome: string,
): DesktopThemePreference {
  const yamlPath = join(xrkHome, "settings.yaml");
  if (existsSync(yamlPath)) {
    try {
      const fromYaml = readThemePreferenceFromSettingsYaml(
        readFileSync(yamlPath, "utf8"),
      );
      if (fromYaml !== undefined) return fromYaml;
    } catch {
      /* fall through */
    }
  }
  const hostPath = join(xrkHome, "host-settings.json");
  if (existsSync(hostPath)) {
    try {
      const fromHost = readThemePreferenceFromHostSettingsJson(
        readFileSync(hostPath, "utf8"),
      );
      if (fromHost !== undefined) return fromHost;
    } catch {
      /* fall through */
    }
  }
  return "system";
}

/** Map preference + OS scheme to a concrete light/dark floor. */
export function resolveDesktopColorScheme(
  preference: DesktopThemePreference,
  systemDark: boolean,
): DesktopColorScheme {
  if (preference === "dark") return "dark";
  if (preference === "light") return "light";
  return systemDark ? "dark" : "light";
}

export function desktopSplashBackgroundColor(
  scheme: DesktopColorScheme,
): string {
  return scheme === "dark" ? DESKTOP_SPLASH_BG_DARK : DESKTOP_SPLASH_BG_LIGHT;
}
