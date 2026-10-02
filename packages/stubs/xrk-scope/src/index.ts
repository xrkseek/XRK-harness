/**
 * Agent-scoped registration tables and event-dispatch carriers.
 *
 * Host packages (`xrk-tools`, `xrk-commands`, `xrk-session`, `xrk-agent`)
 * register through `agent.ctx` and dispatch with a {@link scopeTarget}
 * carrier so tagged listeners only hear their own agent.
 *
 * @module @xrkseek/xrk-scope
 */
import { Context } from '@xrkseek/cordis'

/** Object identity used as a scope key (typically a live Agent). */
export type ScopeKey = object

/** One contribution table that can report whether it still owns anything. */
export interface ScopeLayer {
  /** Whether every contribution in this layer is empty. */
  isEmpty(): boolean
}

/** Subject object carrying the Cordis listener filter for one scope key. */
export type Scoped<T> = T & {
  [Context.filter]: (ctx: Context) => boolean
}

/** Context tag written by {@link isolateScope}. */
const kScope = Symbol('xrk.scope')

/**
 * Read the nearest scope key on a context (own or inherited via `extend`).
 * @param ctx - any Cordis context.
 * @returns the tagged key, or `undefined` on a plain root context.
 */
export function scopeOf(ctx: Context): ScopeKey | undefined {
  return (ctx as Context & { [kScope]?: ScopeKey })[kScope]
}

/**
 * Child context tagged with `key` and a dispatch filter: untagged listeners
 * hear every event; tagged listeners hear only a matching key.
 * @param ctx - parent context.
 * @param key - owning agent (or other object identity).
 * @returns the tagged child context.
 */
export function isolateScope(ctx: Context, key: ScopeKey): Context {
  return ctx.extend({
    [kScope]: key,
    [Context.filter](listenerCtx: Context): boolean {
      const tag = scopeOf(listenerCtx)
      return tag === undefined || tag === key
    },
  })
}

/**
 * Attach (or replace) the Cordis listener filter on `source` so emits that
 * pass this object as `thisArg` are scope-filtered.
 * @param source - the dispatch subject (agent, session, or service).
 * @param key - the owning scope, or `undefined` for untagged (global) dispatch.
 * @returns `source` with the filter installed.
 */
export function scopeTarget<T extends object>(source: T, key: ScopeKey | undefined): Scoped<T> {
  const carrier = source as Scoped<T>
  Object.defineProperty(carrier, Context.filter, {
    configurable: true,
    enumerable: false,
    writable: true,
    value(listenerCtx: Context): boolean {
      const tag = scopeOf(listenerCtx)
      return tag === undefined || tag === key
    },
  })
  return carrier
}

/** Named map that rejects duplicate keys with a caller-supplied error. */
export class NamedEntries<T> {
  private readonly items = new Map<string, T>()

  /**
   * @param duplicate - factory for the error thrown when `insert` collides.
   */
  constructor(private readonly duplicate: (name: string) => Error) {}

  /**
   * Insert `name` → `value`. Throws when the name is already live.
   * @param name - unique key inside this layer.
   * @param value - registered value.
   * @returns disposer that removes this exact entry.
   */
  insert(name: string, value: T): () => void {
    if (this.items.has(name)) throw this.duplicate(name)
    this.items.set(name, value)
    return () => { this.items.delete(name) }
  }

  /** @returns whether no names remain. */
  isEmpty(): boolean {
    return this.items.size === 0
  }

  /** @returns live `[name, value]` pairs. */
  entries(): IterableIterator<[string, T]> {
    return this.items.entries()
  }

  /** @returns live values. */
  values(): IterableIterator<T> {
    return this.items.values()
  }
}

/** Ordered bag of unnamed contributions (restrictions, guards). */
export class AnonymousEntries<T> {
  private seq = 0
  private readonly items = new Map<number, T>()

  /**
   * Append one contribution.
   * @param value - the live entry.
   * @returns disposer that removes this exact entry.
   */
  append(value: T): () => void {
    const id = this.seq
    this.seq += 1
    this.items.set(id, value)
    return () => { this.items.delete(id) }
  }

  /** @returns whether no contributions remain. */
  isEmpty(): boolean {
    return this.items.size === 0
  }

  /** @returns live values in insertion order. */
  values(): IterableIterator<T> {
    return this.items.values()
  }
}

/**
 * Global + per-scope contribution layers. Registrations go through
 * {@link ScopedLayers.effect} so they unwind with the calling fiber.
 */
export class ScopedLayers<L extends ScopeLayer> {
  readonly global: L
  private readonly scoped = new Map<ScopeKey, L>()
  private readonly parents = new WeakMap<ScopeKey, ScopeKey>()

  /**
   * @param create - mint one layer for `scope` (`undefined` = global).
   * @param onChange - fire after a registration is added or removed.
   */
  constructor(
    private readonly create: (scope: ScopeKey | undefined) => L,
    private readonly onChange: () => void,
  ) {
    this.global = create(undefined)
  }

  /**
   * Apply `register` against the layer selected by `scopeOf(ctx)`.
   * @param ctx - calling context (plain = global; tagged = that scope).
   * @param register - mutates the layer and returns its inner disposer.
   * @param opts - optional Cordis effect label.
   * @returns the exact `ctx.effect` disposer.
   */
  effect(
    ctx: Context,
    register: (layer: L) => () => void,
    opts?: { label?: string },
  ): () => void {
    const scope = scopeOf(ctx)
    this.rememberParent(ctx, scope)
    const run = (): (() => void) => {
      const layer = this.layerOf(scope)
      const inner = register(layer)
      this.onChange()
      return () => {
        inner()
        if (scope !== undefined && layer.isEmpty()) this.scoped.delete(scope)
        this.onChange()
      }
    }
    const label = opts?.label
    return label === undefined ? ctx.effect(run) : ctx.effect(run, label)
  }

  /**
   * Layers from farthest ancestor to the exact scope, always starting with
   * the global layer. Missing (never-contributed) scoped layers are omitted.
   * @param scope - viewing agent, or `undefined` for the global view.
   * @returns the ordered chain.
   */
  chainLayers(scope?: ScopeKey): L[] {
    const chain: L[] = [this.global]
    if (scope === undefined) return chain
    const keys: ScopeKey[] = []
    const seen = new Set<ScopeKey>()
    let current: ScopeKey | undefined = scope
    while (current !== undefined && !seen.has(current)) {
      seen.add(current)
      keys.push(current)
      current = this.parents.get(current)
    }
    keys.reverse()
    for (const key of keys) {
      const layer = this.scoped.get(key)
      if (layer !== undefined) chain.push(layer)
    }
    return chain
  }

  /**
   * The layer this scope owns, or `undefined` until it contributes.
   * The global view returns {@link global}.
   * @param scope - viewing agent, or `undefined` for global.
   */
  peek(scope?: ScopeKey): L | undefined {
    if (scope === undefined) return this.global
    return this.scoped.get(scope)
  }

  /**
   * Merge named tables along {@link chainLayers}: farther names first, nearer
   * same-name entries shadow.
   * @param scope - viewing agent.
   * @param pick - select the named table on one layer.
   */
  merge<T>(
    scope: ScopeKey | undefined,
    pick: (layer: L) => NamedEntries<T>,
  ): Map<string, T> {
    const merged = new Map<string, T>()
    for (const layer of this.chainLayers(scope)) {
      for (const [name, value] of pick(layer).entries()) merged.set(name, value)
    }
    return merged
  }

  private layerOf(scope: ScopeKey | undefined): L {
    if (scope === undefined) return this.global
    const existing = this.scoped.get(scope)
    if (existing !== undefined) return existing
    const created = this.create(scope)
    this.scoped.set(scope, created)
    return created
  }

  private rememberParent(ctx: Context, scope: ScopeKey | undefined): void {
    if (scope === undefined || this.parents.has(scope)) return
    const parentKey = parentScopeOf(ctx, scope)
    if (parentKey !== undefined) this.parents.set(scope, parentKey)
  }
}

/** Walk fiber parents for a nearer-then-farther different scope tag. */
function parentScopeOf(ctx: Context, self: ScopeKey): ScopeKey | undefined {
  let current: Context | undefined = ctx.fiber.parent
  const seen = new Set<Context>()
  while (current !== undefined && !seen.has(current)) {
    seen.add(current)
    const key = scopeOf(current)
    if (key !== undefined && key !== self) return key
    const parent = current.fiber.parent
    if (parent === current) break
    current = parent
  }
  return undefined
}
