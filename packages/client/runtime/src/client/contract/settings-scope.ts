/**
 * The settings-namespace scope contract. The type lives here, in the common
 * dependency of every feature that owns a preference, while the implementation
 * and its Host transport live with the Settings surface
 * (`dsh-client-ui-settings`): a feature service accepts a scope through
 * `attachSettings` without depending on the surface that binds it, which would
 * otherwise close a reference cycle.
 */

/** Client-side sync state of one settings namespace. */
export interface SettingsScopeSnapshot<T> {
  /**
   * `loading` until the first accepted section, `ready` while one stands, and
   * `unavailable` when the namespace is not exposed to this client or the
   * connection keeps preferences process-local (memory mode).
   */
  status: 'loading' | 'ready' | 'unavailable'
  /** Last accepted schema-resolved section; undefined before the first acceptance. */
  value: T | undefined
  /**
   * Composition layer the Host resolved {@link value} over, when the owning
   * plugin declared one. What a field reverts to once cleared.
   */
  base: unknown
  /**
   * Raw user layer as stored, when one exists. A field's PRESENCE here is what
   * marks it overridden — an override whose value equals the composition
   * default is still an override, and comparing values could not see it.
   */
  user: unknown
  /** Namespace revision fencing the next write; undefined before the first Host view. */
  revision: number | undefined
  /** Whether the Host document accepts writes; memory mode never does. */
  writable: boolean
  /** `host` syncs with the Host document; `memory` keeps a remote browser process-local. */
  mode: 'host' | 'memory'
}

/** Domain-owned description of one settings namespace consumed by a browser plugin. */
export interface SettingsScopeSpec<T> {
  /** Settings namespace registered by the owning Host plugin. */
  namespace: string
  /**
   * Narrow one wire section; undefined keeps the last accepted value. The
   * default validates the section against the namespace's own serialized wire
   * schema, so domains add a decoder only to narrow beyond that schema.
   */
  decode?: (section: unknown) => T | undefined
}

/**
 * One path-addressed edit for {@link SettingsScope.patch}. Mirrors Host
 * `settings.mutate` ops without importing the Face wire package into the
 * runtime contract layer.
 */
export type SettingsScopePathOp =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] }

/**
 * Reactive owner handle over one namespace's durable section — the browser
 * mirror of the Host-side `SettingsScope` owner seam. Domain services read
 * and observe the snapshot and route explicit user choices through `set`.
 */
export interface SettingsScope<T> {
  /** @returns the current sync snapshot (stable reference until the next change). */
  getSnapshot(): SettingsScopeSnapshot<T>
  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each snapshot change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void
  /**
   * Queue one field write. Rapid writes preserve mutation order, each carries
   * the latest known namespace revision, and only the latest settlement may
   * publish; a rejected or failed latest write reloads Host state instead.
   * A revision conflict refreshes once and retries the same op before recovering.
   * @param field - scalar field inside the namespace section.
   * @param value - JSON-shaped value selected by the user.
   * @returns settlement after the write and any latest-write recovery read.
   */
  set(field: string, value: unknown): Promise<void>
  /**
   * Queue one field clear, so the field re-inherits the composition layer.
   * Shares {@link set}'s ordering, revision, and recovery contract.
   * @param field - scalar field inside the namespace section.
   * @returns settlement after the clear and any latest-write recovery read.
   */
  unset(field: string): Promise<void>
  /**
   * Queue several path ops in one Host mutate (single revision bump). Use for
   * fields that must land together (mood + tip + moodAt). Shares {@link set}'s
   * ordering, conflict-retry, and recovery contract.
   * @param ops - path edits applied atomically by the Host.
   * @returns settlement after the write and any latest-write recovery read.
   */
  patch(ops: readonly SettingsScopePathOp[]): Promise<void>
}
