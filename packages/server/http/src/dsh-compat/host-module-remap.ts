/**
 * Register Node import remaps for community Cordis host packages.
 */
import { existsSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

let registered = false;

function resolveHookHref(): string {
  for (const rel of [
    "./host-module-remap-hook.js",
    "./host-module-remap-hook.ts",
  ] as const) {
    const href = new URL(rel, import.meta.url).href;
    try {
      if (existsSync(fileURLToPath(href))) return href;
    } catch {
      /* ignore bad file URLs */
    }
  }
  return new URL("./host-module-remap-hook.js", import.meta.url).href;
}

/** Idempotent: safe to call before every community host apply. */
export function ensureHostModuleRemap(): void {
  if (registered) return;
  registered = true;
  register(resolveHookHref(), import.meta.url);
}
