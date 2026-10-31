/**
 * Desktop first-paint appearance + language: read durable Settings before Host
 * is up, so splash / window floor / shell locale match product preference
 * (not OS-only defaults).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Light splash / window floor — matches AppRoot light fallback. */
export const DESKTOP_SPLASH_BG_LIGHT = "#f4f4f5" as const;

/** Dark splash / window floor — `--dsw-static-neutral-bluish-950`. */
export const DESKTOP_SPLASH_BG_DARK = "#151517" as const;

export type DesktopThemePreference = "light" | "dark" | "system";
export type DesktopColorScheme = "light" | "dark";
/** Product `locale.preference` ids (Face / client). */
export type DesktopLocalePreference = "zh" | "en" | "ja";

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

/**
 * Best-effort parse of `locale.preference` from `$XRK_HOME/settings.yaml`
 * (same thin regex style as {@link readThemePreferenceFromSettingsYaml}).
 */
export function readLocalePreferenceFromSettingsYaml(
  text: string,
): DesktopLocalePreference | undefined {
  const block = /(?:^|\n)locale:\s*\n((?:[ \t]+[^\n]*\n?)*)/u.exec(text);
  if (block === null) return undefined;
  const pref = /(?:^|\n)[ \t]+preference:\s*(zh|en|ja)\b/u.exec(block[1] ?? "");
  if (pref === null) return undefined;
  return pref[1] as DesktopLocalePreference;
}

/** Fallback from redacted `host-settings.json` (`ui.locale`). */
export function readLocalePreferenceFromHostSettingsJson(
  text: string,
): DesktopLocalePreference | undefined {
  try {
    const parsed = JSON.parse(text) as {
      ui?: { locale?: unknown };
    };
    const locale = parsed.ui?.locale;
    if (locale === "zh" || locale === "en" || locale === "ja") {
      return locale;
    }
  } catch {
    /* ignore malformed */
  }
  return undefined;
}

/**
 * Resolve durable locale preference from Harness home (settings.yaml first,
 * then host-settings.json). Undefined when neither stores an explicit choice
 * — callers then fall through to OS / Chromium `app.getLocale()`.
 */
export function resolveDesktopLocalePreference(
  xrkHome: string,
): DesktopLocalePreference | undefined {
  const yamlPath = join(xrkHome, "settings.yaml");
  if (existsSync(yamlPath)) {
    try {
      const fromYaml = readLocalePreferenceFromSettingsYaml(
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
      return readLocalePreferenceFromHostSettingsJson(
        readFileSync(hostPath, "utf8"),
      );
    } catch {
      /* fall through */
    }
  }
  return undefined;
}

/**
 * Locale tag for shell IPC / menus / splash: product Settings wins, else OS.
 */
export function resolveDesktopShellLocaleTag(
  xrkHome: string,
  osLocale: string,
): string {
  return resolveDesktopLocalePreference(xrkHome) ?? osLocale;
}
