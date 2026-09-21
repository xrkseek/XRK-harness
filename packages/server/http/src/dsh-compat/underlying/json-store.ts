/**
 * Path + JSON file primitives (`XRK_HOME` / `~/.xrk`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveConfiguredXrkHome } from "@xrkseek/xrk-home-paths";

/** Product home for dsh-compat stores — shared with `@xrkseek/xrk-home-paths`. */
export function resolveCompatHome(
  xrkHome?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveConfiguredXrkHome(xrkHome, env);
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
