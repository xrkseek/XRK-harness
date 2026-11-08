/**
 * Peek / mirror Desktop `desktop.preventIdleSleep` for Electron main.
 * Face `settings.yaml` is the product SoT; a small JSON mirror under XRK_HOME
 * lets main arm the sleep inhibitor before Host Fetch is up (same pattern as
 * boot theme peek + cli-command pref).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const PREVENT_IDLE_SLEEP_PREF_FILE = "prevent-idle-sleep.json";

export function preventIdleSleepPrefPath(xrkHome: string): string {
  return path.join(xrkHome, PREVENT_IDLE_SLEEP_PREF_FILE);
}

/** Missing or unreadable pref → off (Codex experimental default). */
export function readPreventIdleSleepEnabled(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") return false;
  try {
    const doc = JSON.parse(raw) as { enabled?: unknown };
    return doc.enabled === true;
  } catch {
    return false;
  }
}

export function writePreventIdleSleepEnabled(enabled: boolean): string {
  return `${JSON.stringify({ enabled }, null, 2)}\n`;
}

/**
 * Best-effort parse of `desktop.preventIdleSleep` from `$XRK_HOME/settings.yaml`
 * without pulling js-yaml into the private Desktop package.
 */
export function readPreventIdleSleepFromSettingsYaml(text: string): boolean | undefined {
  const block = /(?:^|\n)desktop:\s*\n((?:[ \t]+[^\n]*\n?)*)/u.exec(text);
  if (block === null) return undefined;
  const flag = /(?:^|\n)[ \t]+preventIdleSleep:\s*(true|false)\b/u.exec(
    block[1] ?? "",
  );
  if (flag === null) return undefined;
  return flag[1] === "true";
}

/**
 * Resolve durable prevent-idle-sleep preference: settings.yaml first, then
 * the Desktop JSON mirror. Defaults to off.
 */
export function resolvePreventIdleSleepEnabled(xrkHome: string): boolean {
  const yamlPath = path.join(xrkHome, "settings.yaml");
  if (existsSync(yamlPath)) {
    try {
      const fromYaml = readPreventIdleSleepFromSettingsYaml(
        readFileSync(yamlPath, "utf8"),
      );
      if (fromYaml !== undefined) return fromYaml;
    } catch {
      /* fall through */
    }
  }
  const pref = preventIdleSleepPrefPath(xrkHome);
  if (existsSync(pref)) {
    try {
      return readPreventIdleSleepEnabled(readFileSync(pref, "utf8"));
    } catch {
      /* fall through */
    }
  }
  return false;
}
