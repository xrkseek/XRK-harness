import type { ServiceKey } from "./types.js";

/**
 * Explicit DI bag — no Proxy, no globals.
 * `set` overwrites; `get` throws if missing (use `getOptional` for soft lookup).
 */
export interface Context {
  readonly id: string;
  get<T>(key: ServiceKey): T;
  getOptional<T>(key: ServiceKey): T | undefined;
  set<T>(key: ServiceKey, value: T): void;
  has(key: ServiceKey): boolean;
  /** Register a disposer; run on dispose() in reverse order. */
  onDispose(fn: () => void | Promise<void>): void;
  dispose(): Promise<void>;
}

export function createContext(id = "root"): Context {
  const services = new Map<ServiceKey, unknown>();
  const disposers: Array<() => void | Promise<void>> = [];
  let disposed = false;

  const assertAlive = (): void => {
    if (disposed) {
      throw new Error(`context "${id}" is disposed`);
    }
  };

  return {
    id,
    get<T>(key: ServiceKey): T {
      assertAlive();
      if (!services.has(key)) {
        const label = typeof key === "symbol" ? key.toString() : String(key);
        throw new Error(`service not found: ${label}`);
      }
      return services.get(key) as T;
    },
    getOptional<T>(key: ServiceKey): T | undefined {
      assertAlive();
      return services.get(key) as T | undefined;
    },
    set<T>(key: ServiceKey, value: T): void {
      assertAlive();
      services.set(key, value);
    },
    has(key: ServiceKey): boolean {
      assertAlive();
      return services.has(key);
    },
    onDispose(fn: () => void | Promise<void>): void {
      assertAlive();
      disposers.push(fn);
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      for (let i = disposers.length - 1; i >= 0; i -= 1) {
        const fn = disposers[i];
        if (fn) await fn();
      }
      disposers.length = 0;
      services.clear();
    },
  };
}
