/**
 * Snapshot store engine (zustand vanilla + immer + subscribeWithSelector +
 * rafFlush middleware + opt-in persist + dev freeze) plus the declarative
 * shell over it: {@link defineStore} bakes an init/persist/actions literal
 * into a {@link StoreHandle}, the registration-side store seat of slot
 * terminals. Lives in the React-free runtime (the data layer owns its
 * engine; web-react is shell-only React
 * glue): engine products are bare observables — subscribe/getSnapshot/
 * update/set, NO selector hook. Hook synthesis is web-react's (the one
 * uSES bridge, cached per source at the binding site).
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import { subscribeWithSelector } from 'zustand/middleware'
import { shallow } from 'zustand/shallow'
import { produce } from 'immer'
import type {
  ActionsDecl, BakedActions, StoreHandle, StoreInstance, StoreSpec,
} from '@xrkseek/client-ui-slots'

// Store contract types are ui-slots authority; re-exported beside the engine
// so store consumers get one import path.
export type {
  ActionsDecl, BakedActions, BoundActions, StoreFactory, StoreHandle, StoreInstance, StoreSpec,
} from '@xrkseek/client-ui-slots'

/** Minimal observable snapshot source: Session objects and snapshot stores both satisfy it. */
export interface ObservableSnapshot<T> { getSnapshot(): T; subscribe(fn: () => void): () => void }

/** Writable snapshot store (bare data face; React selector hooks are synthesized in web-react). */
export interface SnapshotStore<T> extends ObservableSnapshot<T> {
  /**
   * Mutate the state through an immer draft.
   * @param mutator - draft mutator.
   */
  update(mutator: (draft: T) => void): void
  /**
   * Replace the state wholesale.
   * @param next - next state.
   */
  set(next: T): void
}

/**
 * Shallow equality for selector slices (zustand/shallow semantics; travels
 * with the engine so hook consumers need no zustand dependency).
 * @param a - left value.
 * @param b - right value.
 * @returns whether the values are shallowly equal.
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  return shallow(a, b)
}

/** Batches subscriber notification into one flush per animation frame. */
function rafBatch(notify: () => void): () => void {
  // Fall back to microtask batching where rAF is absent (node unit tests);
  // both preserve the N-changes=1-notification contract within a tick.
  const schedule: (fn: () => void) => void =
    typeof requestAnimationFrame === 'function'
      ? (fn) => { requestAnimationFrame(() => { fn() }) }
      : (fn) => { queueMicrotask(fn) }
  let scheduled = false
  return () => {
    if (scheduled) return
    scheduled = true
    schedule(() => {
      scheduled = false
      notify()
    })
  }
}

/**
 * Create a snapshot store.
 *
 * Flush default is 'sync' (controlled inputs need same-tick echo); frame-driven
 * stores opt into 'raf', where a frame's worth of updates coalesces into one
 * notification. Known raf-mode tradeoff: a component mounting mid-frame reads
 * fresh state while existing subscribers hear it next flush — transient
 * frame-level skew, same nature as the object layer's microtask batching.
 *
 * @param init - initial state.
 * @param opts - flush mode and opt-in persistence (localStorage, keyed by name).
 * @returns the store.
 */
export function createSnapshotStore<T>(
  init: T, opts?: { flush?: 'raf' | 'sync'; persist?: { name: string } }): SnapshotStore<T> {
  // Immer enters through produce() in update() below (identical semantics to
  // the immer middleware without its setState-signature mutator generics).
  const withSelector = subscribeWithSelector(() => init)
  const api: StoreApi<T> = createStore<T>()(withSelector)
  if (opts?.persist) attachPersistence(api, opts.persist.name)

  let subscribe = (fn: () => void) => api.subscribe(fn)
  if (opts?.flush === 'raf') {
    const listeners = new Set<() => void>()
    const flush = rafBatch(() => { for (const fn of [...listeners]) fn() })
    api.subscribe(flush)
    subscribe = (fn: () => void) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    }
  }

  return {
    getSnapshot: () => api.getState(),
    subscribe: fn => subscribe(fn),
    update: (mutator) => {
      // Immer's produce (not setState's partial-merge path) so scalar and
      // array roots replace correctly; produce also freezes in dev.
      api.setState(produce(api.getState(), (draft) => { mutator(draft as T) }), true)
    },
    set: (next) => {
      api.setState(devFreeze(next), true)
    },
  }
}

/**
 * Soft ceiling for one localStorage entry. Oversized drafts (paste storms)
 * would otherwise burn through the origin quota and stall the main thread on
 * stringify + sync write; prefer a truncated salvage over failing closed.
 */
const MAX_PERSIST_CHARS = 256_000

/** Coalesce keystroke-rate drafts into one disk write (INP / main-thread). */
const PERSIST_DEBOUNCE_MS = 120

/** Live persist controllers keyed by storage name — clearPersisted cancels pending writes. */
const persistControllers = new Map<string, { cancel: () => void; flush: () => void }>()

/**
 * Serialize store state for disk. When the payload would exceed
 * {@link MAX_PERSIST_CHARS} and the root carries a string `draft`, truncate
 * that field first so selection / view / inspect still survive reload.
 */
function serializePersistedState(state: unknown): string {
  const full = JSON.stringify(state)
  if (full.length <= MAX_PERSIST_CHARS) return full
  if (
    state !== null
    && typeof state === 'object'
    && !Array.isArray(state)
    && 'draft' in state
    && typeof (state as { draft: unknown }).draft === 'string'
  ) {
    const draft = (state as { draft: string }).draft
    const overhead = full.length - draft.length
    const keep = Math.max(0, MAX_PERSIST_CHARS - overhead)
    return JSON.stringify({ ...(state as object), draft: draft.slice(0, keep) })
  }
  return full.slice(0, MAX_PERSIST_CHARS)
}

/**
 * Whole-value JSON persistence to localStorage. Hand-rolled instead of the
 * zustand persist middleware: its write path spreads state into an object
 * (`partialize({ ...get() })`), exploding primitive state (a persisted string
 * draft becomes {0:'h',1:'e',...}) — not fixable via merge/deserialize options
 * because the corruption happens before serialization. Storage failures
 * (quota, private mode) only disable persistence, never break the store.
 *
 * Writes are debounced and skip identical payloads so composer draft mirrors
 * do not pay a synchronous disk write on every keystroke (Vercel
 * js-cache-storage / client-localstorage-schema habits).
 */
function attachPersistence<T>(api: StoreApi<T>, name: string): void {
  // Non-browser runs (node e2e booting the client tree) have no localStorage:
  // persistence silently disables — same contract as a storage failure, minus
  // the per-store console noise a ReferenceError would produce.
  if (typeof localStorage === 'undefined') return
  let lastSerialized: string | null = null
  let pending: T | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancelled = false

  try {
    const raw = localStorage.getItem(name)
    lastSerialized = raw
    if (raw !== null) {
      api.setState(devFreeze(JSON.parse(raw) as T), true)
    }
  } catch (error) {
    console.error(`snapshot store '${name}' rehydration failed:`, error)
  }

  const flush = (): void => {
    timer = undefined
    if (cancelled || pending === undefined) return
    const state = pending
    pending = undefined
    try {
      const serialized = serializePersistedState(state)
      if (serialized === lastSerialized) return
      localStorage.setItem(name, serialized)
      lastSerialized = serialized
    } catch (error) {
      console.error(`snapshot store '${name}' persistence failed:`, error)
    }
  }

  const cancel = (): void => {
    cancelled = true
    pending = undefined
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    if (persistControllers.get(name)?.cancel === cancel) persistControllers.delete(name)
  }

  persistControllers.set(name, { cancel, flush })

  api.subscribe((state) => {
    if (cancelled) return
    pending = state
    if (timer !== undefined) return
    timer = setTimeout(flush, PERSIST_DEBOUNCE_MS)
  })

  // Last keystrokes must land before the tab is discarded.
  const onPageHide = (): void => { flush() }
  if (typeof addEventListener === 'function') {
    addEventListener('pagehide', onPageHide)
  }
}

/** Cancel a pending debounced write before removing the storage key. */
function cancelPersistedWrites(name: string): void {
  persistControllers.get(name)?.cancel()
}

/** Deep-freeze wholesale-set state outside production: set() bypasses immer's freeze. */
function devFreeze<T>(value: T): T {
  // Client tsc programs omit Node typings; bundlers still replace this shape.
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV
  if (nodeEnv === 'production') return value
  deepFreeze(value)
  return value
}

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return
  Object.freeze(value)
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key])
  }
}

// ui-slots owns the contract; this module supplies the engine implementation.

/** A live engine instance: the contract instance plus the raw engine store. */
export interface EngineStoreInstance<T, A extends ActionsDecl<T>> extends StoreInstance<T, A> {
  /** The underlying engine store (framework/test API; components never see it). */
  readonly store: SnapshotStore<T>
}

/** The engine-backed handle: create() narrowed to the engine instance. */
export interface EngineStoreHandle<T, A extends ActionsDecl<T>> extends StoreHandle<T, A> {
  /**
   * Construct a live engine instance (see the contract JSDoc on
   * {@link StoreHandle.create} for scopeKey/persist semantics).
   *
   * Known boundary: the persist key is the storage identity, so multiple live
   * instances created under the same resolved key share (and cross-pollute)
   * one localStorage entry. Instance uniqueness per key is the caller's
   * responsibility — production is safe because the framework caches one
   * instance per handle x scope key; tests wanting isolation use distinct
   * scope keys or persist-free declarations (multi-create freedom is a
   * feature there, so create() deliberately does not dedupe or throw).
   * @param scopeKey - session id for session-scope instances; omitted for root scope.
   * @returns the engine instance.
   */
  create(scopeKey?: string): EngineStoreInstance<T, A>
}

/**
 * Declare a store: initial state, optional persistence, and the full write
 * set as pure draft mutators. The returned handle is the registration
 * currency of the store seat — its identity keys instance sharing. Satisfies
 * ui-slots' DefineStore contract (the handle/instance are the engine-extended
 * subtypes).
 *
 * The `A & ActionsDecl<T>` actions position is load-bearing: T resolves from
 * `init` in the first inference round, and the intersection then contextually
 * types each mutator's draft parameter (context-sensitive functions defer),
 * so call sites write `(d, x: X) => { ... }` with no draft annotation. If a
 * future TS version breaks this single-literal inference, the design's
 * documented fallback is currying (`defineStore(init).actions({...})`).
 * @param decl - init lambda (fresh state per instance), optional persist key, actions table.
 * @returns the store handle.
 */
export function defineStore<T, A extends ActionsDecl<T>>(
  decl: StoreSpec<T, A> & { actions: A & ActionsDecl<T> }): EngineStoreHandle<T, A> {
  return {
    spec: decl,
    create(scopeKey?: string): EngineStoreInstance<T, A> {
      const persistKey = decl.persist === undefined
        ? undefined
        : scopeKey === undefined ? decl.persist : `${decl.persist}.${scopeKey}`
      const store = createSnapshotStore<T>(
        decl.init(),
        persistKey !== undefined ? { persist: { name: persistKey } } : undefined)
      const actions = {} as Record<string, (...params: unknown[]) => void>
      for (const key of Object.keys(decl.actions)) {
        const mutate = decl.actions[key] as (draft: T, ...params: unknown[]) => void
        actions[key] = (...params: unknown[]) => { store.update((draft) => { mutate(draft, ...params) }) }
      }
      return {
        actions: actions as BakedActions<T, A>,
        getSnapshot: () => store.getSnapshot(),
        subscribe: fn => store.subscribe(fn),
        store,
        clearPersisted: () => {
          if (persistKey === undefined || typeof localStorage === 'undefined') return
          cancelPersistedWrites(persistKey)
          try {
            localStorage.removeItem(persistKey)
          } catch {
            // Storage failures (private mode, quota teardown races) only skip
            // cleanup — the same non-fatal contract as attachPersistence.
          }
        },
      }
    },
  }
}
