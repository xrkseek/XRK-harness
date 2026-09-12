/**
 * Path + JSON file primitives (`XRK_HOME` / `~/.xrk`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const HOME_ENVS = ["XRK_HOME", "XRK_DSH_HOME", "DSH_HOME"] as const;

function expandHomePath(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(homedir(), value.slice(2));
  }
  return value;
}

/**
 * Product home for dsh-compat stores. Mirrors server-config `resolveXrkHome`
 * without taking that dependency (http stays below Host).
 */
export function resolveCompatHome(
  xrkHome?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = xrkHome?.trim();
  if (explicit) return path.resolve(expandHomePath(explicit));
  for (const key of HOME_ENVS) {
    const raw = env[key]?.trim();
    if (raw) return path.resolve(expandHomePath(raw));
  }
  return path.resolve(path.join(homedir(), ".xrk"));
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readJsonFile<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function dataPath(
  xrkHome: string | undefined,
  ...parts: string[]
): string {
  return path.join(resolveCompatHome(xrkHome), ...parts);
}
