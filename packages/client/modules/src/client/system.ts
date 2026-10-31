/**
 * ClientModuleSystem — the implementation behind the {@link ClientModuleLoader}
 * contract. The conceptual contract (lazy CJS model, resolution branch order) is
 * documented on the public interfaces in `./manifest.ts`; this file owns the
 * state tables and the load/materialize machinery.
 */
import type {
  BootModuleRow, ClientModuleLoader, ClientModuleRecord,
  ClientModuleSystemOptions, ClientPluginHandoff, XrkWindow,
} from './manifest.ts'
import { remapDshClientRequire } from './dsh-require-remap.ts'
import { isSamePluginPackage, unscopedPackageName } from './package-id.ts'

/** Default bundle-load hook: same-origin external classic script. */
const defaultLoadBundle = (url: string): Promise<void> => new Promise((resolve, reject) => {
  const el = document.createElement('script')
  el.async = true
  el.src = url
  el.addEventListener('load', () => {
    el.remove()
    resolve()
  }, { once: true })
  el.addEventListener('error', () => {
    el.remove()
    reject(new Error(`client-modules: bundle script ${url} failed to load`))
  }, { once: true })
  document.head.append(el)
})

/**
 * A plugin bundle IS its package's client half: `<id>/client` (the exports
 * subpath external bundles emit) and the bare graph id name the same
 * exports, so table lookups normalize the suffix away.
 */
const stripClientSuffix = (spec: string): string =>
  spec.endsWith('/client') ? spec.slice(0, -'/client'.length) : spec

/**
 * Claim and inventory the <style> tags a factory injected during
 * materialization: preset-emitted tags arrive pre-tagged with data-plugin;
 * any untagged tag is claimed for the materializing plugin (HMR bookkeeping).
 */
const claimStyles = (id: string): string[] => {
  if (typeof document === 'undefined') return []
  for (const el of document.querySelectorAll('style:not([data-plugin])')) {
    el.setAttribute('data-plugin', id)
  }
  const owned: string[] = []
  for (const el of document.querySelectorAll(`style[data-plugin=${JSON.stringify(id)}]`)) {
    owned.push(el.getAttribute('data-plugin-css') ?? id)
  }
  return owned
}

/**
 * The client module system: state tables plus the arrival/materialization
 * machinery implementing {@link ClientModuleLoader} (whose members carry the
 * contract documentation). Construction indexes the boot rows and installs the
 * `window.__ModuleLoader__` registration sink — once per page.
 */
export class ClientModuleSystem implements ClientModuleLoader {
  readonly version = 'client'
  readonly loadCache = new Map<string, ClientModuleRecord>()

  private readonly seed: Map<string, unknown>
  private readonly statics = new Map<string, unknown>()
  private readonly factories = new Map<string, ClientPluginHandoff['factory']>()
  /** In-flight prefetch (script load) per id; concurrent callers share it. */
  private readonly pendingArrival = new Map<string, Promise<void>>()
  /** Materialization re-entrancy guard: factory-form CJS cannot deliver partial exports, so a cycle is fatal. */
  private readonly materializing = new Set<string>()
  private readonly graphRows = new Map<string, BootModuleRow>()
  private readonly loadBundle: (url: string) => Promise<void>
  /**
   * Graph row id whose classic script is executing. DSH keeps registration id
   * === row id; XRK additionally accepts the same plugin family under a bare /
   * scoped rename (community republish) and dual-keys the factory.
   */
  private executingId = ''

  /**
   * Build the module system over the parsed boot rows.
   * @param options - Module rows, module-table staticModules, and bundle-load hook.
   */
  constructor(options: ClientModuleSystemOptions) {
    this.seed = new Map(Object.entries(options.staticModules))
    this.loadBundle = options.loadBundle ?? defaultLoadBundle

    for (const row of options.modules) {
      if (this.graphRows.has(row.id)) throw new Error(`client-modules: duplicate graph entry "${row.id}"`)
      this.graphRows.set(row.id, row)
    }

    const win = globalThis as XrkWindow
    if (win.__ModuleLoader__ !== undefined) throw new Error('client-modules: window.__ModuleLoader__ already installed (double boot?)')
    win.__ModuleLoader__ = {
      load: (handoff: ClientPluginHandoff): void => {
        this.acceptHandoff(handoff)
      },
    }
  }

  /** Store one factory; duplicate registration for the same key is always loud. */
  private putFactory(id: string, factory: ClientPluginHandoff['factory']): void {
    if (this.factories.has(id)) {
      throw new Error(`client-modules: duplicate factory registration for "${id}" (bundle executed twice without invalidate?)`)
    }
    this.factories.set(id, factory)
  }

  /**
   * Accept a ModuleLoader handoff. Exact id match is the DSH contract; XRK also
   * dual-keys every boot-graph id in the same plugin family (bare ↔
   * `@scope/bare`) so community republishes work.
   *
   * Boot prefetches many classic `async` scripts in parallel, so a single
   * `executingId` can point at a sibling row when this handoff runs. Never
   * reject a stamp that matches a known graph family — that race used to
   * throw "mis-stamped" and surface as "loaded without registering".
   */
  private acceptHandoff(handoff: ClientPluginHandoff): void {
    const stamped = handoff.id
    const expected = this.executingId
    const matchesGraphFamily = [...this.graphRows.keys()].some((rowId) =>
      isSamePluginPackage(rowId, stamped),
    )
    if (
      expected !== ''
      && stamped !== expected
      && !isSamePluginPackage(stamped, expected)
      && !matchesGraphFamily
    ) {
      throw new Error(
        `client-modules: bundle registered "${stamped}" while arriving for "${expected}" (mis-stamped bundle id)`,
      )
    }
    // Exact stamp twice is always loud (bundle executed twice without invalidate).
    this.putFactory(stamped, handoff.factory)
    this.dualKeyFamily(stamped, handoff.factory)
    if (
      expected !== ''
      && expected !== stamped
      && isSamePluginPackage(stamped, expected)
      && !this.factories.has(expected)
    ) {
      this.putFactory(expected, handoff.factory)
    }
  }

  /** Mirror one factory onto every boot-graph id in the same plugin family. */
  private dualKeyFamily(
    stamped: string,
    factory: ClientPluginHandoff['factory'],
  ): void {
    for (const rowId of this.graphRows.keys()) {
      if (rowId === stamped) continue
      if (!isSamePluginPackage(rowId, stamped)) continue
      if (this.factories.has(rowId)) continue
      this.putFactory(rowId, factory)
    }
  }

  /**
   * After script load, ensure the graph-row id has a factory — exact stamp,
   * bare↔scoped dual-key, or any already-registered same-family key.
   */
  private hasFactoryFor(id: string): boolean {
    if (this.factories.has(id)) return true
    const bare = unscopedPackageName(id)
    if (bare !== id && this.factories.has(bare)) {
      const factory = this.factories.get(bare)
      /* v8 ignore next -- guarded by has(bare) above. */
      if (factory === undefined) return false
      this.factories.set(id, factory)
      return true
    }
    for (const [key, factory] of this.factories) {
      if (!isSamePluginPackage(key, id)) continue
      this.factories.set(id, factory)
      return true
    }
    return false
  }

  /** Load one graph row so its factory is registered (idempotent per in-flight arrival). */
  private arrive(row: BootModuleRow): Promise<void> {
    const { id, url } = row
    const pending = this.pendingArrival.get(id)
    if (pending !== undefined) return pending
    if (this.hasFactoryFor(id)) return Promise.resolve()
    const task = (async () => {
      // Track the intended row for diagnostics / late dual-key; parallel
      // arrivals may overwrite this — acceptHandoff must not rely on it alone.
      this.executingId = id
      try {
        await this.loadBundle(url)
      } finally {
        if (this.executingId === id) this.executingId = ''
      }
      if (!this.hasFactoryFor(id)) {
        throw new Error(`client-modules: bundle ${url} loaded without registering "${id}" via __ModuleLoader__.load`)
      }
    })().finally(() => { this.pendingArrival.delete(id) })
    this.pendingArrival.set(id, task)
    return task
  }

  /** Materialize a registered factory (synchronous; memoized in loadCache). */
  private materialize(id: string): ClientModuleRecord {
    const existing = this.loadCache.get(id)
    if (existing !== undefined) return existing
    const registered = this.factories.get(id)
    /* v8 ignore next -- callers check the factory branch before dispatching here. */
    if (registered === undefined) throw new Error(`client-modules: no registered factory for "${id}"`)
    if (this.materializing.has(id)) {
      throw new Error(`client-modules: require cycle through "${id}" (factory-form CJS cannot deliver partial exports)`)
    }
    this.materializing.add(id)
    try {
      const edges = new Set<string>()
      const exports = registered(this.makeRequire(edges))
      const record: ClientModuleRecord = { id, exports, styles: claimStyles(id), edges }
      this.loadCache.set(id, record)
      return record
    } finally {
      this.materializing.delete(id)
    }
  }

  /**
   * Resolve one require specifier against seed → static → cache → factory.
   * @returns exports, or `undefined` when nothing matches.
   */
  private lookupRequire(spec: string): unknown | undefined {
    if (this.seed.has(spec)) return this.seed.get(spec)
    if (this.statics.has(spec)) return this.statics.get(spec)
    const id = stripClientSuffix(spec)
    if (id !== spec) {
      if (this.seed.has(id)) return this.seed.get(id)
      if (this.statics.has(id)) return this.statics.get(id)
    }
    const record = this.loadCache.get(id)
    if (record !== undefined) return record.exports
    if (this.factories.has(id)) return this.materialize(id).exports
    return undefined
  }

  /**
   * The synchronous require answered to factories: seed → static → memoized
   * record → registered factory (recursive materialization — this is what
   * makes load order self-resolving). Community DSH bundles that still
   * `require("@deepseek-ai/dsh-client-*")` are remapped onto `@xrkseek/client-*`
   * (same seed / graph rows). Fetching is async and therefore unreachable
   * from here; an unregistered plugin specifier is loud.
   */
  private makeRequire(edges: Set<string>): (spec: string) => unknown {
    return (spec: string): unknown => {
      edges.add(spec)
      const direct = this.lookupRequire(spec)
      if (direct !== undefined) return direct
      const mapped = remapDshClientRequire(spec)
      if (mapped !== undefined && mapped !== spec) {
        edges.add(mapped)
        const viaAlias = this.lookupRequire(mapped)
        if (viaAlias !== undefined) return viaAlias
      }
      throw new Error(
        `client-modules: require("${spec}") missed the module table — not a platform seed word, not a shell-own module, `
        + 'and no registered factory (a build-time externals drift, or a forbidden cross-plugin value import)',
      )
    }
  }

  /**
   * Graph row id for a require/import specifier (DSH remap + `/client` suffix).
   */
  private graphIdFor(spec: string): string {
    const mapped = remapDshClientRequire(spec)
    return stripClientSuffix(mapped ?? spec)
  }

  async import(specifier: string): Promise<unknown> {
    // Shell-own statics populate loadCache on first import (styles inventory
    // stays empty — they never inject <style data-plugin>).
    if (this.statics.has(specifier)) {
      const cached = this.loadCache.get(specifier)
      if (cached !== undefined) return cached.exports
      const exports = this.statics.get(specifier)
      this.loadCache.set(specifier, {
        id: specifier,
        exports,
        styles: [],
        edges: new Set(),
      })
      return exports
    }
    const direct = this.lookupRequire(specifier)
    if (direct !== undefined) return direct
    const mapped = remapDshClientRequire(specifier)
    if (mapped !== undefined && mapped !== specifier) {
      const viaAlias = this.lookupRequire(mapped)
      if (viaAlias !== undefined) return viaAlias
    }
    const existing = this.loadCache.get(specifier)
    if (existing !== undefined) return existing.exports
    const id = this.graphIdFor(specifier)
    if (!this.hasFactoryFor(id)) {
      const row = this.graphRows.get(id)
      if (row === undefined) {
        throw new Error(
          `client-modules: cannot resolve "${specifier}" — not a seed word, not a shell-own module, `
          + 'and not a row in the boot graph (the runtime mirror of the bundle purity gate)',
        )
      }
      await this.arrive(row)
    }
    return this.materialize(id).exports
  }

  registerStatic(id: string, module: unknown): void {
    if (this.statics.has(id)) throw new Error(`client-modules: shell-own module "${id}" registered twice`)
    this.statics.set(id, module)
  }

  async prefetch(id: string): Promise<void> {
    if (this.statics.has(id)) return
    const row = this.graphRows.get(id)
    if (row === undefined) throw new Error(`client-modules: prefetch("${id}") — not a graph entry`)
    await this.arrive(row)
  }

  invalidate(id: string): void {
    this.factories.delete(id)
    this.loadCache.delete(id)
    const bare = unscopedPackageName(id)
    if (bare !== id) {
      this.factories.delete(bare)
      this.loadCache.delete(bare)
    }
  }

  adopt(row: BootModuleRow): void {
    if (this.statics.has(row.id)) return
    this.graphRows.set(row.id, { id: row.id, url: row.url, rev: row.rev })
  }
}
