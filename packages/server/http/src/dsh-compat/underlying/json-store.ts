/**
 * Path + JSON file primitives (`XRK_HOME` / `~/.xrk`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

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
  const home =
    xrkHome?.trim() ||
    process.env.XRK_HOME?.trim() ||
    path.join(homedir(), ".xrk");
  return path.join(path.resolve(home), ...parts);
}
