import type { Disposer, Scope } from "./types.js";

/**
 * Run `register()` (e.g. `bus.on(...)`) and attach its disposer as a scope effect.
 */
export function bindDisposable(
  scope: Scope,
  register: () => Disposer,
  meta?: { label?: string },
): Disposer {
  return scope.effect(register, meta);
}
