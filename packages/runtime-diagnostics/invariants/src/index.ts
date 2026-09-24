/**
 * Cordis-free registry for package-owned runtime invariant contributions.
 * Face / Host compositions mount this; Cordis overlays keep using
 * `@xrkseek/xrk-invariants` under stubs.
 *
 * @module @xrkseek/runtime-invariants
 */

import type { SessionEvent } from "@xrkseek/protocol";

/** Runtime invariant selection. */
export interface InvariantRegistryConfig {
  /** Global switch; defaults to `true`. */
  readonly enabled?: boolean;
  /** Case-sensitive JS regex sources that admit package names; empty admits all. */
  readonly packageAllowlist?: readonly string[];
  /** Case-sensitive JS regex sources that exclude package names after allowlist. */
  readonly packageBlocklist?: readonly string[];
}

/**
 * Throw a package-attributed invariant failure.
 * @returns never — reporting a violation always throws.
 */
export type InvariantFailure = (message: string) => never;

/** One committed append observation (event not yet in `prefix`). */
export interface SessionAppendObservation {
  readonly sessionId: string;
  readonly event: SessionEvent;
  /** Events already committed before this append. */
  readonly prefix: readonly SessionEvent[];
}

/** API handed to each package companion installer. */
export interface InvariantInstallApi {
  /**
   * Observe every store append after Host wraps the SessionStore.
   * @returns disposer that removes the listener.
   */
  onAppend(listener: (obs: SessionAppendObservation) => void): () => void;
}

/** Install one package's checks. */
export type InvariantInstaller = (
  api: InvariantInstallApi,
  fail: InvariantFailure,
) => void | Promise<void>;

/** Thrown when a package-owned runtime invariant is violated. */
export class InvariantError extends Error {
  readonly code = "INVARIANT" as const;
  readonly packageName: string;

  constructor(packageName: string, message: string) {
    super(`invariant violated by "${packageName}": ${message}`);
    this.name = "InvariantError";
    this.packageName = packageName;
  }
}

/** Compile and validate one package-filter list. */
function compilePatterns(
  field: "packageAllowlist" | "packageBlocklist",
  values: readonly string[],
): RegExp[] {
  const seen = new Set<string>();
  return values.map((value) => {
    if (value.length === 0 || value.trim() !== value) {
      throw new Error(
        `invariants: ${field} entries must be non-blank and have no surrounding whitespace`,
      );
    }
    if (seen.has(value)) {
      throw new Error(
        `invariants: ${field} contains duplicate regex ${JSON.stringify(value)}`,
      );
    }
    seen.add(value);
    try {
      return new RegExp(value);
    } catch (cause) {
      throw new Error(
        `invariants: ${field} contains invalid regex ${JSON.stringify(value)}`,
        { cause },
      );
    }
  });
}

/** Env truthy for Host optional fail-fast (`XRK_INVARIANTS_FAIL_FAST`). */
export function resolveInvariantsFailFast(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.XRK_INVARIANTS_FAIL_FAST?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** Package-owned invariant registry with global and regex-based selection. */
export class InvariantRegistry {
  private readonly enabled: boolean;
  private readonly packageAllowlist: readonly RegExp[];
  private readonly packageBlocklist: readonly RegExp[];
  private readonly registrations = new Set<string>();
  private readonly appendListeners = new Set<
    (obs: SessionAppendObservation) => void
  >();
  private disposed = false;

  constructor(config: InvariantRegistryConfig = {}) {
    this.enabled = config.enabled ?? true;
    this.packageAllowlist = compilePatterns(
      "packageAllowlist",
      config.packageAllowlist ?? [],
    );
    this.packageBlocklist = compilePatterns(
      "packageBlocklist",
      config.packageBlocklist ?? [],
    );
  }

  private selected(packageName: string): boolean {
    if (!this.enabled) return false;
    if (
      this.packageAllowlist.length > 0 &&
      !this.packageAllowlist.some((pattern) => pattern.test(packageName))
    ) {
      return false;
    }
    return !this.packageBlocklist.some((pattern) => pattern.test(packageName));
  }

  /**
   * Register one package's invariant installer.
   * The package name is reserved even when filters disable its checks.
   */
  register(packageName: string, installer: InvariantInstaller): () => void {
    if (this.disposed) {
      throw new Error("invariants: registry is disposed");
    }
    if (
      packageName.length === 0 ||
      packageName.trim() !== packageName ||
      /\s/.test(packageName)
    ) {
      throw new Error(
        "invariants: packageName must be non-blank and contain no whitespace",
      );
    }
    if (this.registrations.has(packageName)) {
      throw new Error(
        `invariants: package "${packageName}" is already registered`,
      );
    }
    this.registrations.add(packageName);

    const fail: InvariantFailure = (message): never => {
      throw new InvariantError(packageName, message);
    };

    const localDisposers: Array<() => void> = [];
    const api: InvariantInstallApi = {
      onAppend: (listener) => {
        this.appendListeners.add(listener);
        const dispose = (): void => {
          this.appendListeners.delete(listener);
        };
        localDisposers.push(dispose);
        return dispose;
      },
    };

    if (this.selected(packageName)) {
      try {
        const result = installer(api, fail);
        if (result !== undefined) {
          throw new Error(
            `invariants: package "${packageName}" installer must be synchronous (got a Promise)`,
          );
        }
      } catch (error) {
        for (const d of localDisposers) d();
        this.registrations.delete(packageName);
        throw error;
      }
    }

    return () => {
      for (const d of localDisposers) d();
      this.registrations.delete(packageName);
    };
  }

  /** Whether a package name is currently reserved. */
  has(packageName: string): boolean {
    return this.registrations.has(packageName);
  }

  /** Fan-out one append observation to active companion listeners. */
  notifyAppend(obs: SessionAppendObservation): void {
    if (this.disposed || !this.enabled) return;
    for (const listener of this.appendListeners) {
      listener(obs);
    }
  }

  dispose(): void {
    this.appendListeners.clear();
    this.registrations.clear();
    this.disposed = true;
  }
}

export function createInvariantRegistry(
  config: InvariantRegistryConfig = {},
): InvariantRegistry {
  return new InvariantRegistry(config);
}

/** Minimal store surface required by {@link wrapSessionStore}. */
export interface InvariantSessionStore {
  get(id: string): { readonly events: readonly SessionEvent[] };
  append(id: string, event: SessionEvent): SessionEvent;
  list(): readonly string[];
  create(id?: string): { readonly id: string; readonly events: readonly SessionEvent[] };
  has(id: string): boolean;
  readEvents?(
    id: string,
    fromSeq?: number,
    toSeqExclusive?: number,
  ): readonly SessionEvent[];
}

/**
 * Wrap a SessionStore so every append notifies the registry **before** commit
 * (fail-fast: violation prevents the underlying append).
 */
export function wrapSessionStore<T extends InvariantSessionStore>(
  store: T,
  registry: InvariantRegistry,
): T {
  const wrapped = Object.create(store) as T;
  wrapped.append = ((id: string, event: SessionEvent): SessionEvent => {
    const prefix = store.get(id).events;
    registry.notifyAppend({ sessionId: id, event, prefix });
    return store.append(id, event);
  }) as T["append"];
  return wrapped;
}

/**
 * Replay an existing log through the registry (Host boot self-check).
 * Does not mutate the store.
 */
export function replaySessionLog(
  registry: InvariantRegistry,
  sessionId: string,
  events: readonly SessionEvent[],
): void {
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]!;
    registry.notifyAppend({
      sessionId,
      event,
      prefix: events.slice(0, i),
    });
  }
}
