/**
 * Minimal browser-test doubles (see index.js).
 *
 * The types are declared structurally, mirroring the runtime contracts the
 * doubles stand in for (`SettingsScope`, `SettingsScopeSnapshot`, the cordis
 * `Context` seam), so this placeholder stub keeps no package dependencies.
 */

/** Build a translate stub over plain dictionaries. */
export function makeTranslate(
  ...dicts: readonly Record<string, string>[]
): (key: string, params?: Record<string, unknown>) => string

/** Bind a bare observable snapshot source to a uSES selector hook. */
export function bindSnapshotSelector<T>(
  w: { subscribe(fn: () => void): unknown; getSnapshot(): T },
): <S>(sel: (s: T) => S, eq?: (a: S, b: S) => boolean) => S

/** Pin the browser language preferences a fresh client tree reads at boot. */
export function usePinnedBrowserLanguages(...tags: readonly string[]): void

/** The context seam `TestRemote` provides its service through. */
export interface TestContext {
  provide(name: string, value: unknown): unknown
}

/** Stand-in for the `remote` service (forwarded Host events). */
export declare class TestRemote {
  constructor(ctx: TestContext)
}

/** One settings-namespace sync snapshot (mirrors `SettingsScopeSnapshot`). */
export interface StubSettingsSnapshot<T = unknown> {
  status: 'loading' | 'ready' | 'unavailable'
  value: T | undefined
  base: unknown
  user: unknown
  revision: number | undefined
  writable: boolean
  mode: 'host' | 'memory'
}

/** The scope handle a service consumes (mirrors `SettingsScope`). */
export interface StubScopeHandle<T = unknown> {
  getSnapshot(): StubSettingsSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

/** A settings-scope stand-in: the scope, its write spies, and a publish seam. */
export interface StubSettingsScope<T = unknown> {
  scope: StubScopeHandle<T>
  set: (field: string, value: unknown) => Promise<void>
  unset: (field: string) => Promise<void>
  publish(next: Partial<StubSettingsSnapshot<T>>): void
  listenerCount(): number
}

/** Build the settings-scope stand-in, optionally with a standing section. */
export function stubSettingsScope<T = unknown>(
  initial?: Partial<StubSettingsSnapshot<T>>,
): StubSettingsScope<T>
