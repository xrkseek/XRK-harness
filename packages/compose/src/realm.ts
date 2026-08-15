import type { ServiceKey } from "./types.js";

/** Stable string key for a (name, label) realm. */
export function realmKey(name: ServiceKey, label?: string): string {
  const n = typeof name === "symbol" ? name.toString() : String(name);
  return `${label ?? ""}@@${n}`;
}

export function keyLabel(key: ServiceKey): string {
  return typeof key === "symbol" ? key.toString() : String(key);
}
