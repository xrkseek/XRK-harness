/**
 * Browser-test doubles for the client bench.
 *
 * Ports the helpers the client specs need to assemble a client tree without
 * the published `@xrkseek/client-test-runtime`: a translate stub, the
 * observable -> hook bridge, a browser-language pin, the forwarded-event port,
 * a settings-scope stand-in, and the slot bench itself — `SlotTestRuntime`
 * with its `TestSessions` / `TestWorkspaces` fixture doubles.
 *
 * Every export here is a TEST double. It lives in a private placeholder stub
 * (`replace with real package or remap`) so `packages/client/*` specs stay
 * runnable until the real package is published. The bench deliberately reuses
 * the production pieces it cannot fake faithfully (`SlotRegistry`, the React
 * slot renderer, `SessionProvideChannel`, `createScope`, snapshot stores) and
 * replaces only the wire-backed halves.
 */
import { createElement, Fragment, type ReactNode } from 'react'
import { act, render, type RenderResult } from '@testing-library/react'
import { vi } from 'vitest'
import { Context } from '@xrkseek/cordis'
import type { Fiber } from '@xrkseek/cordis'
import {
  ConversationEventRegistry,
  ConversationViewRegistry,
  createScope,
  createSnapshotStore,
  EMPTY_CHAT_SNAPSHOT,
  EMPTY_CONVERSATION_VIEWS,
  scopeOf as scopeTagOf,
  SessionProvideChannel,
  SlotRegistry,
} from '@xrkseek/client-runtime/client'
import type {
  AgentContext,
  ConversationSnapshot,
  ISession,
  ISessions,
  IWorkspaces,
  SessionBinding,
  SessionId,
  SessionListState,
  SessionProvideDescriptor,
  SessionSummary,
  SnapshotStore,
  WorkspaceListState,
  WorkspaceView,
} from '@xrkseek/client-runtime/client'
import type { WorkspaceId } from '@xrkseek/xrk-api-remotes/client'
import { bindSnapshotSelector, createSlotRenderer } from '@xrkseek/client-web-react'
import type {
  HostObservable,
  SessionMaybeProvideInfo,
  SessionProvideInfo,
  SlotRenderer,
  SlotRendererHost,
  StoreInstanceLike,
} from '@xrkseek/client-ui-slots'

export { bindSnapshotSelector }
export type { UseSession } from '@xrkseek/client-web-react'

/* ------------------------------------------------------------------ helpers */

/**
 * Build a translate stub resolving through `dicts` in order (namespace first,
 * then shared vocab), falling back to the key. Interpolates `{name}` params.
 * @param dicts - dictionaries consulted in order.
 * @returns a translate function assignable to locale `t` seats.
 */
export function makeTranslate(
  ...dicts: readonly Record<string, string>[]
): (key: string, params?: Record<string, unknown>) => string {
  return (key, params) => {
    let template = key
    for (const dict of dicts) {
      const hit = dict[key]
      if (hit !== undefined) {
        template = hit
        break
      }
    }
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      (name in params ? String(params[name]) : match))
  }
}

/**
 * Pin the browser language preferences a fresh client tree resolves its
 * initial locale from: the ordered `languages` list plus the single legacy
 * `language` tag the locale service walks after it. `vi.stubGlobal` keeps the
 * pin reversible by the usual `vi.unstubAllGlobals()` teardown.
 *
 * Specs that need shapes this helper cannot express — a missing `languages`
 * list, a list decoupled from `language`, or a non-browser run with no
 * `window` — stub the globals themselves instead.
 * @param tags - BCP-47 tags in browser preference order.
 * @returns nothing; the pin stands until the spec restores the globals.
 */
export function usePinnedBrowserLanguages(...tags: string[]): void {
  vi.stubGlobal('navigator', {
    languages: [...tags],
    language: tags[0] ?? '',
  })
}

/**
 * The forwarded Host-event port. The connection sink fans every wire event out
 * through the `remote` service's `$dispatch`, so specs assemble this double to
 * hand a plugin the same `$on`/`$dispatch` pair the sink speaks, then drive it
 * by dispatching the events a live Host would send.
 */
export class TestRemote {
  /**
   * @param ctx - client cordis context; receives the `remote` service.
   */
  constructor(ctx: Context) {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    ctx.provide('remote', {
      /**
       * Subscribe one listener to a forwarded event.
       * @param event - wire event name.
       * @param listener - invoked with the dispatched arguments.
       * @returns the disposer removing this listener.
       */
      $on: (event: string, listener: (...args: unknown[]) => void) => {
        let seat = listeners.get(event)
        if (!seat) listeners.set(event, (seat = new Set()))
        seat.add(listener)
        return () => {
          seat!.delete(listener)
        }
      },
      /**
       * Fan one event out to its listeners, in subscription order.
       * @param event - wire event name.
       * @param args - the arguments the wire event carried.
       */
      $dispatch: (event: string, args: unknown[]) => {
        for (const listener of [...(listeners.get(event) ?? [])]) listener(...args)
      },
    } as never)
  }
}

/** One recorded service verb: the method name plus its exact argument list. */
export interface TestCall {
  /** Method name as it appears on the contract face. */
  method: string
  /** Arguments the caller passed, verbatim. */
  args: readonly unknown[]
}

/**
 * Stand-in settings scope for specs whose subject consumes a namespace scope
 * but does not exercise the Host transport. The returned handle carries the
 * scope itself plus its write spies and a `publish` seam, so a spec can assert
 * a service adopted the Host section (`host.set` untouched) or that an explicit
 * user choice wrote through (`host.set` called with the field and value).
 *
 * The scope starts where a real `SettingsScopeController` starts: `loading`,
 * no value, no revision, not writable, `host` mode. `publish` merges a snapshot
 * patch and notifies subscribers, mirroring one accepted Host read.
 * @param initial - snapshot fields standing at construction.
 * @returns the scope handle, its write spies, and the publish seam.
 */
/**
 * Yield one macrotask inside `act` so Lexical's non-discrete `editor.update`
 * queue (claim / text-ref decorations) commits to the DOM before assertions.
 * Prefer this over naked `waitFor` when the only thing pending is a paint.
 * @returns completion of the flush.
 */
export async function flushComposer(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => { setTimeout(resolve, 0) })
  })
}

/**
 * Read the blank-args claim ghost hint from the composer host. Production
 * paints it via CSS `::after` fed by `--xrk-composer-hint` (JSON-stringified);
 * it is not part of the contenteditable `textContent`.
 * @param host - the `[data-composer-input]` element (or any ancestor carrying the var).
 * @returns the hint string, or null when absent.
 */
export function composerHintOf(host: Element | null | undefined): string | null {
  if (host === null || host === undefined) return null
  const raw = (host as HTMLElement).style.getPropertyValue('--xrk-composer-hint').trim()
  if (raw === '') return null
  try {
    return JSON.parse(raw) as string
  } catch {
    return raw
  }
}

/**
 * Adapt a Lexical `[data-composer-input]` host so older textarea-shaped
 * assertions keep working: `.value` reads/writes the shell draft; `.readOnly`
 * mirrors a false `contenteditable` attribute (Lexical's editable prop);
 * `.disabled` mirrors `aria-disabled` (blocked / removed — workspace trigger
 * stays read-only without aria-disabled so the chip stays clickable);
 * `.placeholder` reads `data-placeholder`.
 *
 * @param host - the contenteditable composer root (`data-composer-input`).
 * @param shell - draft face (`snapshot.draft` + `setDraft`).
 * @returns the same element, with the textarea-shaped properties defined.
 */
export function bindComposerHost(
  host: Element,
  shell: { readonly snapshot: { readonly draft: string }; setDraft(text: string): void },
): HTMLElement & { value: string; readOnly: boolean; disabled: boolean; placeholder: string } {
  const el = host as HTMLElement & {
    value: string
    readOnly: boolean
    disabled: boolean
    placeholder: string
  }
  Object.defineProperty(el, 'value', {
    configurable: true,
    enumerable: true,
    get: () => shell.snapshot.draft,
    set: (text: string) => { shell.setDraft(String(text)) },
  })
  Object.defineProperty(el, 'readOnly', {
    configurable: true,
    enumerable: true,
    // Prefer the attribute Lexical/React write; `isContentEditable` can lag
    // the attribute in jsdom around the setRootElement bind.
    get: () => el.getAttribute('contenteditable') === 'false',
    set: () => { /* Lexical editability is driven by the editable prop */ },
  })
  Object.defineProperty(el, 'disabled', {
    configurable: true,
    enumerable: true,
    get: () => el.getAttribute('aria-disabled') === 'true',
    set: () => { /* aria-disabled is driven by the InputBar locked path */ },
  })
  Object.defineProperty(el, 'placeholder', {
    configurable: true,
    enumerable: true,
    get: () => el.getAttribute('data-placeholder') ?? '',
    set: () => { /* placeholder is a data attribute on the Lexical host */ },
  })
  return el
}

export function stubSettingsScope(initial: Record<string, unknown> = {}) {
  let snapshot: Record<string, unknown> = {
    status: 'loading',
    value: undefined,
    base: undefined,
    user: undefined,
    revision: undefined,
    writable: false,
    mode: 'host',
    ...initial,
  }
  const listeners = new Set<() => void>()
  const set = vi.fn(() => Promise.resolve())
  const unset = vi.fn(() => Promise.resolve())
  return {
    scope: {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      set,
      unset,
    },
    // The write spies are the scope's own, so `host.set` and `scope.set`
    // assertions see one call log.
    set,
    unset,
    /**
     * Publish a snapshot patch, as one accepted Host read would.
     * @param next - fields the read carried; the rest stand.
     */
    publish: (next: Record<string, unknown>) => {
      snapshot = { ...snapshot, ...next }
      for (const listener of [...listeners]) listener()
    },
    /** @returns how many listeners still hold the scope. */
    listenerCount: () => listeners.size,
  }
}

/* ------------------------------------------------------------ stabilizer */

/**
 * Run one fixture mutation inside React's `act()` so every subscription,
 * effect and re-render settles before the next assertion reads.
 */
export type Stabilizer = (fn: () => unknown) => Promise<void>

/** The default stabilizer: `act(async ...)` around one callback. */
export const stabilize: Stabilizer = async fn => {
  await act(async () => {
    await fn()
  })
}

/* --------------------------------------------------------- value cells */

/** A bare mutable observable: the projection-store stand-in for one key. */
interface ValueCell<T> {
  getSnapshot(): T
  subscribe(fn: () => void): () => void
  set(next: T): void
}

/**
 * Build a plain value observable. Immer drafts cannot stand as the root of a
 * primitive projection, so the bench owns this minimal cell instead.
 * @param initial - the value before the first `set`.
 * @returns the cell face (`getSnapshot` / `subscribe` / `set`).
 */
function createValueCell<T>(initial: T): ValueCell<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: fn => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    set: next => {
      if (Object.is(next, value)) return
      value = next
      for (const fn of [...listeners]) fn()
    },
  }
}

/* --------------------------------------------------------- TestSessions */

/** Per-session verb overrides: any contract member plus the concrete `open`. */
export type SessionBehaviorOverrides = Partial<Omit<ISession, 'sessionId' | 'projections'>> & {
  /** Present on the concrete Session class only (the wire open handshake). */
  open?: () => Promise<void>
}

/** One fixture row: identity, list metadata, snapshot seed, verb behavior. */
export interface TestSessionFixture {
  /** The session id this fixture answers to. */
  id: SessionId
  /** Fields merged over the standing `SessionSummary`. */
  summary?: Partial<SessionSummary>
  /** Fields merged over the empty `ConversationSnapshot` skeleton. */
  snapshot?: Partial<ConversationSnapshot>
  /** Overrides for the session face (verbs default to no-op mocks). */
  session?: SessionBehaviorOverrides
}

/** What `behavior(id)` hands back: everything a spec drives one session with. */
export interface TestSessionBehavior {
  /** The addressed session id. */
  sessionId: SessionId
  /** The session face entries receive through the provide channel. */
  session: ISession
  /** The Agent-scoped context owned by this session. */
  ctx: AgentContext
  /** The live snapshot store behind `session.getSnapshot`. */
  snapshot: SnapshotStore<ConversationSnapshot>
  /** Key-addressed projection cells (`set` publishes to `faceOf` readers). */
  projections: {
    faceOf(key: string): HostObservable<unknown>
    set(key: string, value: unknown): void
  }
}

/** Everything the bench keeps per added session. */
interface TestSessionRecord {
  id: SessionId
  ctx: AgentContext
  fiber: Fiber
  session: ISession
  binding: SessionBinding
  summary: SessionSummary
  snapshot: SnapshotStore<ConversationSnapshot>
  projections: Map<string, ValueCell<unknown>>
  /** Lazily materialized provide bundle (rebuilt when the roster changes). */
  info?: SessionProvideInfo
}

/** The empty snapshot every fixture starts from (specs merge their seed over it). */
function emptyConversationSnapshot(id: SessionId): ConversationSnapshot {
  return {
    sessionId: id,
    views: EMPTY_CONVERSATION_VIEWS,
    chat: EMPTY_CHAT_SNAPSHOT,
    nodes: [],
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: [],
    pending: [],
    pendingSubmissions: [],
    queue: [],
    running: false,
    subagent: null,
    composerPhase: 'blank',
    removed: false,
    openState: 'cold',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: true,
    lastAgentError: null,
  } as unknown as ConversationSnapshot
}

/** The standing summary a fixture's `summary` patch merges over. */
function baseSummary(id: SessionId): SessionSummary {
  return {
    sessionId: id,
    title: id,
    displayTitle: id,
    cwd: `/proj/${id}`,
    createdAt: 0,
    updatedAt: 0,
    messageCount: 0,
    blank: true,
  } as unknown as SessionSummary
}

/** Absent-current projection feed (the no-session render state). */
const ABSENT_CONNECTION_STATE: HostObservable<string> = {
  getSnapshot: () => 'connected',
  subscribe: () => () => {},
}

/** Handshake phase feed when specs stub only `connectionState` (pre-connect). */
const ABSENT_CONNECTION_PHASE: HostObservable<undefined> = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
}

/**
 * Fixture-driven `ISessions` double. The list store, the Agent scopes and the
 * provide channel are the production pieces; only the wire is replaced:
 *   - `add()` mints a scope and publishes the list; it never calls
 *     `session.open()` (assembly must stay side-effect-free, and specs assert
 *     exactly that).
 *   - the contract verbs (`open`, `fork`, `clear`, …) record into `calls` so a
 *     spec can assert what a component actually asked for.
 *   - `fork()` resolves the source id, which is what makes a fork-then-open
 *     flow observable as `open(source)` under a fixture.
 */
export class TestSessions implements ISessions {
  /** Verbatim record of every contract call (test helpers excluded). */
  readonly calls: TestCall[] = []
  /** The useSessions feed (production snapshot-store semantics). */
  readonly list: SnapshotStore<SessionListState>

  private readonly records = new Map<SessionId, TestSessionRecord>()
  private readonly channel: SessionProvideChannel
  private readonly stubs = new Map<string, (...args: unknown[]) => unknown>()

  /**
   * @param stabilize - act() wrapper for every published mutation.
   * @param ctx - client root context the session scopes hang off.
   */
  constructor(
    private readonly stabilize: Stabilizer,
    private readonly ctx: Context,
  ) {
    this.list = createSnapshotStore<SessionListState>({
      ids: [],
      byId: {},
      current: undefined,
      phase: 'pending',
      subagentsByParent: {},
      jobsBySession: {},
      currentAddress: undefined,
    } as unknown as SessionListState)
    this.channel = new SessionProvideChannel({
      rebuildBundles: () => {
        for (const record of this.records.values()) {
          // Lazily-materialized sessions pick the new roster up on first resolve.
          if (record.info !== undefined) record.info = this.channel.materializeInfo(record.binding)
        }
      },
      resolveCurrent: () => {
        const current = this.list.getSnapshot().current
        const record = current === undefined ? undefined : this.records.get(current)
        return record === undefined ? this.channel.maybeInfo : this.infoOf(record)
      },
    })
  }

  /** The atomic current-session provide projection (production channel). */
  get currentProvideInfo(): HostObservable<SessionMaybeProvideInfo> {
    return this.channel.currentProvideInfo
  }

  /** The bound search-result cap the wire schema reports. */
  readonly searchResultLimit = 50

  /**
   * Add one fixture session. Does not touch `session.open()`.
   * @param fixture - identity, summary/snapshot seed, verb overrides.
   * @param options - `current: false` adds without selecting.
   * @returns completion of the published list change.
   */
  async add(fixture: TestSessionFixture, options?: { current?: boolean }): Promise<void> {
    await this.stabilize(() => {
      const record = this.mint(fixture)
      this.records.set(record.id, record)
      this.list.update(draft => {
        if (!draft.ids.includes(record.id)) draft.ids.push(record.id)
        draft.byId[record.id] = record.summary
        draft.phase = 'ready'
        if (options?.current !== false) draft.current = record.id
      })
      this.channel.publishCurrent()
    })
  }

  /**
   * Select a fixture session as current (test-only: no call record, no open).
   * @param id - an added session id.
   * @returns completion of the published selection.
   */
  async setCurrent(id: SessionId): Promise<void> {
    await this.stabilize(() => {
      this.list.update(draft => {
        draft.current = id
      })
      this.channel.publishCurrent()
    })
  }

  /**
   * Drop one fixture session: its scope is disposed, its per-session store
   * instances are pruned, and the list forgets it.
   * @param id - the session to remove.
   * @returns completion of the teardown and published removal.
   */
  async remove(id: SessionId): Promise<void> {
    this.record('remove', [id])
    const record = this.records.get(id)
    if (record === undefined) return
    await this.stabilize(() => {
      this.records.delete(id)
      void record.fiber.dispose()
      this.ctx.slots?.pruneStoreScope(id)
      this.list.update(draft => {
        const at = draft.ids.indexOf(id)
        if (at >= 0) draft.ids.splice(at, 1)
        delete draft.byId[id]
        if (draft.current === id) draft.current = undefined
      })
      this.channel.publishCurrent()
    })
  }

  /**
   * Read a fixture's live provide bundle (materialized on demand).
   * @param id - session id.
   * @returns the bundle, or undefined for an unknown session.
   */
  provideInfo(id: SessionId): SessionProvideInfo | undefined {
    const record = this.records.get(id)
    return record === undefined ? undefined : this.infoOf(record)
  }

  /**
   * Everything a spec drives one session with (face, scope, snapshot, projections).
   * @param id - session id.
   * @returns the behavior handle, or undefined for an unknown session.
   */
  behavior(id: SessionId): TestSessionBehavior | undefined {
    const record = this.records.get(id)
    if (record === undefined) return undefined
    return {
      sessionId: record.id,
      session: record.session,
      ctx: record.ctx,
      snapshot: record.snapshot,
      projections: {
        faceOf: key => this.cellOf(record, key),
        set: (key, value) => { this.cellOf(record, key).set(value) },
      },
    }
  }

  /**
   * Patch one fixture session's snapshot through the live store.
   * @param id - session id.
   * @param mutate - immer draft mutator (same semantics as production stores).
   * @returns completion of the published update.
   */
  async updateSnapshot(id: SessionId, mutate: (draft: ConversationSnapshot) => void): Promise<void> {
    const record = this.records.get(id)
    if (record === undefined) return
    await this.stabilize(() => {
      record.snapshot.update(mutate)
    })
  }

  /**
   * Patch one fixture session's list row.
   * @param id - session id.
   * @param mutate - immer draft mutator over the standing summary.
   * @returns completion of the published list change.
   */
  async updateSummary(id: SessionId, mutate: (draft: SessionSummary) => void): Promise<void> {
    const record = this.records.get(id)
    if (record === undefined) return
    await this.stabilize(() => {
      // List publishes freeze prior rows; clone before the draft mutator runs.
      const next = { ...record.summary }
      mutate(next)
      record.summary = next
      this.list.update(draft => {
        draft.byId[id] = next
      })
    })
  }

  /**
   * Replace one contract verb on the double (the seam for behavior this bench
   * cannot guess, e.g. a spec asserting a custom `fork` result).
   * @param method - contract method name.
   * @param impl - the stand-in implementation.
   * @returns this, for chaining.
   */
  stub(method: keyof ISessions, impl: (...args: never[]) => unknown): this {
    this.stubs.set(method as string, impl as (...args: unknown[]) => unknown)
    return this
  }

  /* --------------------------------------------------- contract verbs */

  /**
   * Select a session as current.
   * @param id - session id.
   */
  open(id: SessionId): void {
    this.record('open', [id])
    const stub = this.stubs.get('open')
    if (stub !== undefined) return void stub(id)
    const record = this.records.get(id)
    if (record === undefined) throw new Error(`sessions.open: unknown session "${id}"`)
    this.list.update(draft => {
      draft.current = id
    })
    this.channel.publishCurrent()
    void record.session.open?.()
  }

  /**
   * Record an attempted subagent open.
   * @param address - catalog-derived parent and child ids.
   */
  openSubagent(address: { parentSessionId: SessionId; sessionId: SessionId }): void {
    this.record('openSubagent', [address])
    this.stubs.get('openSubagent')?.(address)
  }

  /**
   * No catalog is discovered under a fixture unless a spec seeds one.
   * @param id - possible addressed child id.
   * @returns never under this bench.
   */
  subagentAddress(id: SessionId): undefined {
    this.record('subagentAddress', [id])
    return undefined
  }

  /**
   * Record a catalog-menu subscription toggle.
   * @param parentSessionId - catalog owner.
   * @param open - current menu state.
   */
  setSubagentCatalogOpen(parentSessionId: SessionId, open: boolean): void {
    this.record('setSubagentCatalogOpen', [parentSessionId, open])
  }

  /**
   * Nothing to refresh without a Host.
   * @param parentSessionId - catalog owner.
   * @returns a resolved promise.
   */
  refreshSubagents(parentSessionId: SessionId): Promise<void> {
    this.record('refreshSubagents', [parentSessionId])
    return Promise.resolve()
  }

  /**
   * Record a composition note onto the fixture row.
   * @param sessionId - the switched session.
   * @param agentPreset - the preset id the host confirmed.
   */
  noteAgentPreset(sessionId: SessionId, agentPreset: string): void {
    this.record('noteAgentPreset', [sessionId, agentPreset])
    this.stubs.get('noteAgentPreset')?.(sessionId, agentPreset)
  }

  setCreateAgentPresetProvider(provider: (() => string | undefined) | undefined): void {
    this.record('setCreateAgentPresetProvider', [provider])
    this.stubs.get('setCreateAgentPresetProvider')?.(provider)
  }

  /** Clear the current selection into the no-session view state. */
  clear(): void {
    this.record('clear', [])
    const stub = this.stubs.get('clear')
    if (stub !== undefined) return void stub()
    this.list.update(draft => {
      draft.current = undefined
      draft.currentAddress = undefined
    })
    this.channel.publishCurrent()
  }

  /**
   * Report an empty result set (there is no Host index to ask).
   * @param query - non-blank literal phrase.
   * @param signal - cancellation for a superseded search.
   * @returns a bounded, empty result.
   */
  search(query: string, signal: AbortSignal): Promise<never> {
    this.record('search', [query, signal])
    const stub = this.stubs.get('search')
    if (stub !== undefined) return stub(query, signal) as never
    return Promise.resolve({ ok: true, value: { items: [], hasMore: false } } as never)
  }

  /**
   * Record a fork and resolve the source id: under a fixture no child session
   * is minted, so a fork-then-open flow observably returns to the source.
   * @param opts - source id, optional cut anchor, optional title bump.
   * @returns the addressed source session id.
   */
  fork(opts: { sessionId: SessionId; atSeq?: number; increaseTitle?: boolean }): Promise<SessionId> {
    this.record('fork', [opts])
    const stub = this.stubs.get('fork')
    if (stub !== undefined) return stub(opts) as Promise<SessionId>
    return Promise.resolve(opts.sessionId)
  }

  /**
   * Record a durable delete and drop the fixture row when present.
   * @param sessionId - session to delete.
   */
  async delete(sessionId: SessionId): Promise<void> {
    this.record('delete', [sessionId])
    const stub = this.stubs.get('delete')
    if (stub !== undefined) {
      await stub(sessionId)
      return
    }
    await this.remove(sessionId)
  }

  /**
   * Register a per-session standard-props provider on the production channel.
   * @param descriptor - static member roster plus per-session resolver.
   * @returns disposer removing the provider.
   */
  provide(descriptor: SessionProvideDescriptor): () => void {
    return this.channel.provide(descriptor)
  }

  /**
   * Resolve an Agent-scoped context view.
   * @param id - session id.
   * @returns the scope ctx, or undefined once removed.
   */
  scope(id: SessionId): AgentContext | undefined {
    return this.records.get(id)?.ctx
  }

  /**
   * Read the session tag off a context this bench created.
   * Must use the production tag helper (same module instance as createScope):
   * cordis Service methods rebind `this.ctx` to a shadow-extended child of the
   * minted actx, so identity compare against `record.ctx` misses. Keep the
   * tag readable after remove() too — production scopeOf does the same, and
   * the next hop (binding()) fails loud with "resolved no binding".
   * @param ctx - any client context.
   * @returns the session id, or undefined for a root or foreign ctx.
   */
  scopeOf(ctx: Context): SessionId | undefined {
    return scopeTagOf(ctx)
  }

  /**
   * Resolve the session face behind an Agent-scoped context.
   * @param ctx - an Agent-scoped context.
   * @returns the face, or undefined for an untagged ctx.
   */
  sessionOf(ctx: Context): ISession | undefined {
    const id = this.scopeOf(ctx)
    return id === undefined ? undefined : this.records.get(id)?.session
  }

  /**
   * Resolve the stable session binding.
   * @param id - session id.
   * @returns the binding, or undefined for an unknown session.
   */
  binding(id: SessionId): SessionBinding | undefined {
    return this.records.get(id)?.binding
  }

  /* ---------------------------------------------------------- internals */

  /** Record one contract call. */
  private record(method: string, args: readonly unknown[]): void {
    this.calls.push({ method, args })
  }

  /** Materialize (or reuse) a record's provide bundle. */
  private infoOf(record: TestSessionRecord): SessionProvideInfo {
    record.info ??= this.channel.materializeInfo(record.binding)
    return record.info
  }

  /** One projection cell, created on first touch. */
  private cellOf(record: TestSessionRecord, key: string): ValueCell<unknown> {
    let cell = record.projections.get(key)
    if (cell === undefined) {
      cell = createValueCell<unknown>(undefined)
      record.projections.set(key, cell)
    }
    return cell
  }

  /** Mint the scope, face, snapshot store and binding for one fixture. */
  private mint(fixture: TestSessionFixture): TestSessionRecord {
    const { ctx, fiber } = createScope(this.ctx, fixture.id)
    const overrides = fixture.session ?? {}
    const snapshot = createSnapshotStore<ConversationSnapshot>({
      ...emptyConversationSnapshot(fixture.id),
      ...fixture.snapshot,
      sessionId: fixture.id,
    })
    const record: TestSessionRecord = {
      id: fixture.id,
      ctx,
      fiber,
      snapshot,
      projections: new Map(),
      summary: { ...baseSummary(fixture.id), ...fixture.summary } as SessionSummary,
      session: undefined as unknown as ISession,
      binding: undefined as unknown as SessionBinding,
    }
    const session = {
      ...overrides,
      sessionId: fixture.id,
      bindScope: () => {},
      open: overrides.open ?? vi.fn(() => Promise.resolve()),
      // Production Session.beginSubmission mints a requestId echo before prompt;
      // sendSession always takes this path for non-subagent sessions.
      beginSubmission: overrides.beginSubmission ?? vi.fn(() => ({
        requestId: `req-${fixture.id}-${Math.random().toString(36).slice(2, 8)}`,
        abandon: vi.fn(),
      })),
      projections: {
        faceOf: (key: string) => this.cellOf(record, key),
      },
      getSnapshot: () => snapshot.getSnapshot(),
      subscribe: (fn: () => void) => snapshot.subscribe(fn),
    } as unknown as ISession
    record.session = session
    record.binding = { sessionId: fixture.id, session, ctx }
    return record
  }
}

/* ------------------------------------------------------- TestWorkspaces */

/**
 * Fixture-driven `IWorkspaces` double: the list is a live store specs can
 * seed through `update`, every verb records into `calls`, and `stub` overrides
 * any method whose bench default a spec does not want.
 */
export class TestWorkspaces implements IWorkspaces {
  /** Verbatim record of every contract call. */
  readonly calls: TestCall[] = []
  /** The useWorkspaces feed. */
  readonly list: SnapshotStore<WorkspaceListState>

  private readonly stubs = new Map<string, (...args: unknown[]) => unknown>()

  /**
   * @param stabilize - act() wrapper for every published mutation.
   */
  constructor(private readonly stabilize: Stabilizer = stabilize) {
    this.list = createSnapshotStore<WorkspaceListState>({
      items: [],
      archivedSessionIds: [],
      pinnedSessionIds: [],
      pinnedWorkspaceIds: [],
      state: 'idle',
      phase: 'ready',
      error: null,
      baselinesReady: true,
      recentWorkspaceId: undefined,
    } as unknown as WorkspaceListState)
  }

  /**
   * Replace one contract verb on the double.
   * @param method - contract method name.
   * @param impl - the stand-in implementation.
   * @returns this, for chaining.
   */
  stub(method: keyof IWorkspaces, impl: (...args: never[]) => unknown): this {
    this.stubs.set(method as string, impl as (...args: unknown[]) => unknown)
    return this
  }

  /**
   * Patch the list state through an immer draft.
   * @param mutate - draft mutator.
   * @returns completion of the published update.
   */
  async update(mutate: (draft: WorkspaceListState) => void): Promise<void> {
    await this.stabilize(() => {
      this.list.update(mutate)
    })
  }

  /**
   * Record a workspace activation.
   * @param workspaceId - the workspace to connect.
   * @returns the stubbed value, else a deterministic session id.
   */
  connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId> {
    this.record('connectWorkspace', [workspaceId])
    const stub = this.stubs.get('connectWorkspace')
    if (stub !== undefined) return stub(workspaceId) as Promise<SessionId>
    return Promise.resolve(`${workspaceId}#session` as unknown as SessionId)
  }

  /**
   * Record a new-session request.
   * @param workspaceId - target workspace, when one is implied.
   */
  startSession(workspaceId?: WorkspaceId): void {
    this.record('startSession', [workspaceId])
    this.stubs.get('startSession')?.(workspaceId)
  }

  /**
   * Record a workspace creation and publish the new row.
   * @param input - the directory to adopt.
   * @returns the stubbed view, else a minimal row.
   */
  create(input: { path: string }): Promise<WorkspaceView> {
    this.record('create', [input])
    const stub = this.stubs.get('create')
    if (stub !== undefined) return stub(input) as Promise<WorkspaceView>
    const view = { workspaceId: input.path, title: input.path, path: input.path } as unknown as WorkspaceView
    void this.update(draft => {
      ;(draft.items as WorkspaceView[]).push(view)
    })
    return Promise.resolve(view)
  }

  /**
   * Record a directory pick.
   * @returns the stubbed path, else a cancelled pick.
   */
  pickDirectory(): Promise<string | null> {
    this.record('pickDirectory', [])
    const stub = this.stubs.get('pickDirectory')
    if (stub !== undefined) return stub() as Promise<string | null>
    return Promise.resolve(null)
  }

  /**
   * Record a directory listing request.
   * @param path - directory to list.
   * @param signal - cancellation for a superseded request.
   * @returns the stubbed listing, else an empty one.
   */
  listDirectory(path?: string, signal?: AbortSignal): Promise<never> {
    this.record('listDirectory', [path, signal])
    const stub = this.stubs.get('listDirectory')
    if (stub !== undefined) return stub(path, signal) as Promise<never>
    return Promise.resolve({ path: path ?? '', entries: [] } as never)
  }

  /**
   * Record a directory creation.
   * @param path - parent directory.
   * @param name - new entry name.
   * @returns the stubbed path, else the joined guess.
   */
  createDirectory(path: string, name: string): Promise<string> {
    this.record('createDirectory', [path, name])
    const stub = this.stubs.get('createDirectory')
    if (stub !== undefined) return stub(path, name) as Promise<string>
    return Promise.resolve(`${path}/${name}`)
  }

  /**
   * Record an open-in-editor request.
   * @param path - file or directory.
   * @param options - reveal toggle.
   * @returns completion of the stub.
   */
  openPath(path: string, options?: { readonly reveal?: boolean }): Promise<void> {
    this.record('openPath', options === undefined ? [path] : [path, options])
    const stub = this.stubs.get('openPath')
    if (stub !== undefined) return stub(path, options) as Promise<void>
    return Promise.resolve()
  }

  /**
   * Rename a workspace row.
   * @param workspaceId - target workspace.
   * @param title - the new title.
   * @returns the stubbed view, else the patched row.
   */
  rename(workspaceId: WorkspaceId, title: string): Promise<WorkspaceView> {
    this.record('rename', [workspaceId, title])
    const stub = this.stubs.get('rename')
    if (stub !== undefined) return stub(workspaceId, title) as Promise<WorkspaceView>
    const row = this.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
    if (row !== undefined) {
      void this.update(draft => {
        const target = (draft.items as { workspaceId: WorkspaceId; title?: string }[])
          .find(item => item.workspaceId === workspaceId)
        if (target !== undefined) target.title = title
      })
    }
    return Promise.resolve(row as WorkspaceView)
  }

  /**
   * Drop a workspace row.
   * @param workspaceId - target workspace.
   * @returns completion of the published removal.
   */
  delete(workspaceId: WorkspaceId): Promise<void> {
    this.record('delete', [workspaceId])
    const stub = this.stubs.get('delete')
    if (stub !== undefined) return stub(workspaceId) as Promise<void>
    return this.update(draft => {
      const items = draft.items as { workspaceId: WorkspaceId }[]
      const at = items.findIndex(item => item.workspaceId === workspaceId)
      if (at >= 0) items.splice(at, 1)
    })
  }

  /**
   * Record a workspace reorder.
   * @param workspaceId - moved workspace.
   * @param beforeWorkspaceId - drop target, undefined for end-of-list.
   * @returns completion of the stub.
   */
  insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void> {
    this.record('insertBefore', [workspaceId, beforeWorkspaceId])
    const stub = this.stubs.get('insertBefore')
    if (stub !== undefined) return stub(workspaceId, beforeWorkspaceId) as Promise<void>
    return Promise.resolve()
  }

  /**
   * Record a session move between workspaces.
   * @param workspaceId - destination workspace.
   * @param sessionId - moved session.
   * @param beforeSessionId - drop target inside the destination.
   * @returns the stubbed row, else the destination row.
   */
  insertSessionBefore(
    workspaceId: WorkspaceId,
    sessionId: SessionId,
    beforeSessionId?: SessionId,
  ): Promise<WorkspaceView> {
    this.record('insertSessionBefore', [workspaceId, sessionId, beforeSessionId])
    const stub = this.stubs.get('insertSessionBefore')
    if (stub !== undefined) return stub(workspaceId, sessionId, beforeSessionId) as Promise<WorkspaceView>
    return Promise.resolve(
      this.list.getSnapshot().items.find(item => item.workspaceId === workspaceId) as WorkspaceView,
    )
  }

  /**
   * Archive a session row.
   * @param sessionId - the session to archive.
   * @returns completion of the published change.
   */
  archiveSession(sessionId: SessionId): Promise<void> {
    this.record('archiveSession', [sessionId])
    return this.mutateArchive(sessionId, true)
  }

  /**
   * Restore an archived session row.
   * @param sessionId - the session to unarchive.
   * @returns completion of the published change.
   */
  unarchiveSession(sessionId: SessionId): Promise<void> {
    this.record('unarchiveSession', [sessionId])
    return this.mutateArchive(sessionId, false)
  }

  /**
   * Pin a session row.
   * @param sessionId - the session to pin.
   * @returns completion of the published change.
   */
  pinSession(sessionId: SessionId): Promise<void> {
    this.record('pinSession', [sessionId])
    return this.mutatePinned(sessionId, true)
  }

  /**
   * Unpin a session row.
   * @param sessionId - the session to unpin.
   * @returns completion of the published change.
   */
  unpinSession(sessionId: SessionId): Promise<void> {
    this.record('unpinSession', [sessionId])
    return this.mutatePinned(sessionId, false)
  }

  /**
   * Pin a workspace row.
   * @param workspaceId - the workspace to pin.
   * @returns completion of the published change.
   */
  pinWorkspace(workspaceId: WorkspaceId): Promise<void> {
    this.record('pinWorkspace', [workspaceId])
    return this.mutatePinnedWorkspace(workspaceId, true)
  }

  /**
   * Unpin a workspace row.
   * @param workspaceId - the workspace to unpin.
   * @returns completion of the published change.
   */
  unpinWorkspace(workspaceId: WorkspaceId): Promise<void> {
    this.record('unpinWorkspace', [workspaceId])
    return this.mutatePinnedWorkspace(workspaceId, false)
  }

  /* ---------------------------------------------------------- internals */

  /** Record one contract call. */
  private record(method: string, args: readonly unknown[]): void {
    this.calls.push({ method, args })
  }

  /** Add or remove one id in the archived roster. */
  private mutateArchive(sessionId: SessionId, archived: boolean): Promise<void> {
    const stub = this.stubs.get(archived ? 'archiveSession' : 'unarchiveSession')
    if (stub !== undefined) return stub(sessionId) as Promise<void>
    return this.update(draft => {
      const ids = draft.archivedSessionIds as SessionId[]
      const at = ids.indexOf(sessionId)
      if (archived && at < 0) ids.push(sessionId)
      if (!archived && at >= 0) ids.splice(at, 1)
    })
  }

  /** Add or remove one id in the pinned roster. */
  private mutatePinned(sessionId: SessionId, pinned: boolean): Promise<void> {
    const stub = this.stubs.get(pinned ? 'pinSession' : 'unpinSession')
    if (stub !== undefined) return stub(sessionId) as Promise<void>
    return this.update(draft => {
      const ids = draft.pinnedSessionIds as SessionId[]
      const at = ids.indexOf(sessionId)
      if (pinned && at < 0) ids.unshift(sessionId)
      if (!pinned && at >= 0) ids.splice(at, 1)
    })
  }

  /** Add or remove one id in the workspace pin roster; pin also leads items. */
  private mutatePinnedWorkspace(workspaceId: WorkspaceId, pinned: boolean): Promise<void> {
    const stub = this.stubs.get(pinned ? 'pinWorkspace' : 'unpinWorkspace')
    if (stub !== undefined) return stub(workspaceId) as Promise<void>
    return this.update(draft => {
      const ids = draft.pinnedWorkspaceIds as WorkspaceId[]
      const at = ids.indexOf(workspaceId)
      if (pinned) {
        if (at >= 0) ids.splice(at, 1)
        ids.unshift(workspaceId)
        const itemAt = draft.items.findIndex(item => item.workspaceId === workspaceId)
        if (itemAt > 0) {
          const [row] = draft.items.splice(itemAt, 1)
          if (row !== undefined) draft.items.unshift(row)
        }
      } else if (at >= 0) {
        ids.splice(at, 1)
      }
    })
  }
}

/* ------------------------------------------------------ SlotTestRuntime */

/** One client package's entry face, exactly as its `client` export ships it. */
export interface SlotTestEntry {
  /** Service names the entry's fiber injects. */
  inject?: readonly string[]
  /** The entry's plugin function. */
  apply?: (ctx: Context) => void | Promise<void>
  /** Optional fiber label. */
  name?: string
}

/** Owner props a `renderSlot` handle re-renders under. */
export type SlotTestOwner = Record<string, unknown>

/** The render handle `renderRoot` / `renderSlot` return. */
export interface SlotTestView {
  /** The React Testing Library result driving this tree. */
  view: RenderResult
  /** RTL's container, lifted for the common `slot.container` read. */
  container: HTMLElement
  /** Re-render the same tree position under new owner props. */
  update(next: SlotTestOwner): void
}

/** A slot tree the bench declared for a test. */
interface SlotTestTarget {
  key: string
  owner: SlotTestOwner
}

/** Marker prop carrying the target through the root frame (never rendered). */
const TEST_SLOT = '__xrkTestSlot'

/** Children declaration shape accepted by the bench (erased against SlotMap). */
type SlotTestChildren = Record<string, unknown>

/**
 * The auto frame: a `root` entry that declares whatever `declare()` was given
 * and renders the child key the current `renderSlot` call asked for. It exists
 * because the ctx-level render face is root-only — a test reaches a child slot
 * the same way production does, through a declaring parent.
 */
function SlotTestFrame(props: { [TEST_SLOT]?: SlotTestTarget; renderSlot?: unknown }): ReactNode {
  const target = props[TEST_SLOT]
  const render = props.renderSlot as ((key: string, owner: object) => ReactNode) | undefined
  if (target === undefined || render === undefined) return null
  return render(target.key, target.owner)
}

/**
 * Browser bench for slot-driven client packages.
 *
 * Assembles a real cordis context with the real `SlotRegistry`, the real React
 * slot renderer (wrapped so the bench can reach the renderer-private host face)
 * and fixture `sessions` / `workspaces` doubles plus a standing `connection`
 * feed. A spec then plays the shell: `provide` what its subject injects,
 * `declare` the slots it contributes into, `mount` the package entry, and
 * render through `renderRoot` / `renderSlot`.
 */
export class SlotTestRuntime {
  /** The client root context. */
  readonly ctx: Context
  /** The real slot registry under test (assigned when the fiber reaches ACTIVE). */
  slots!: SlotRegistry
  /** Fixture session list + scopes. */
  readonly sessions: TestSessions
  /** Fixture workspace list. */
  readonly workspaces: TestWorkspaces
  /** The `root` slot face: occupy the root entry with the spec's own frame. */
  readonly root = {
    /**
     * Declare the root's child slots and mount `AppRoot` as the root entry.
     * @param children - slot specs the contributing entries target.
     * @param appRoot - the root component (the AppFrame role).
     * @returns completion of the registration.
     */
    declare: async (children: SlotTestChildren, appRoot: unknown): Promise<void> => {
      this.registerRoot(children, appRoot)
    },
  }

  private hostFace: SlotRendererHost | undefined
  private registryFiber: Fiber | undefined
  private rootDisposer: (() => void) | undefined
  private readonly fibers: Fiber[] = []
  private readonly views: RenderResult[] = []

  private constructor() {
    this.ctx = new Context()
    this.sessions = new TestSessions(stabilize, this.ctx)
    this.workspaces = new TestWorkspaces(stabilize)
  }

  /**
   * Boot one bench: registry mounted, renderer installed, fixture services
   * provided. Each call is an isolated context; dispose it when done.
   * @returns the ready bench.
   */
  static async create(): Promise<SlotTestRuntime> {
    const runtime = new SlotTestRuntime()
    await runtime.boot()
    return runtime
  }

  /**
   * Mount the registry (the fiber must reach ACTIVE before `ctx.get('slots')`
   * resolves), install a renderer that captures the renderer-private host
   * face, and provide the fixture services every subject injects.
   */
  private async boot(): Promise<void> {
    this.registryFiber = await this.ctx.plugin(SlotRegistry).await()
    this.slots = this.ctx.get('slots') as unknown as SlotRegistry
    // Production runtime apply() constructs these on the root ctx so every
    // package that injects `conversationEvents` / `conversationViews` can
    // register Definitions. Without them mount() settles but apply never
    // runs (fiber waits on unsatisfied inject), so slot contributions stay
    // empty and storeOf() reports "not registered".
    new ConversationEventRegistry(this.ctx)
    new ConversationViewRegistry(this.ctx)
    // The host face is renderer-private; capture it on the way through
    // install so storeOf()/entries() can delegate to the real resolution.
    const real = createSlotRenderer()
    const capturing: SlotRenderer = {
      renderRoot: (host, ownerProps) => {
        this.hostFace = host
        return real.renderRoot(host, ownerProps)
      },
    }
    this.slots.install(capturing)
    this.provide('sessions', this.sessions)
    this.provide('workspaces', this.workspaces)
    this.provide('connection', {
      api: { settings: {} },
      isLoopback: false,
      connectionState: ABSENT_CONNECTION_STATE,
      connectionPhase: ABSENT_CONNECTION_PHASE,
    })
  }

  /**
   * Provide or replace one service the subject injects.
   *
   * Boot registers a default double for every inject service the terminal
   * declares, so a spec that swaps one of them is *overwriting*: cordis
   * `provide` throws on a name already in the store, hence the set-first
   * branch. Both calls stay on the root fiber — the bench's owns the
   * defaults and a spec body runs with that same fiber active, which is the
   * precondition `reflect.set` checks.
   *
   * @param name - service name (`connection`, `locale`, `layout`, …).
   * @param value - the service face.
   */
  provide(name: string, value: unknown): void {
    // hostFace() reads connectionState/connectionPhase on every render; specs
    // often stub only `api`, so guarantee observable feeds (WeakMap-safe objects).
    if (name === 'connection') {
      const connection = (value ?? {}) as Record<string, unknown>
      value = {
        ...connection,
        connectionState: connection.connectionState ?? ABSENT_CONNECTION_STATE,
        connectionPhase: connection.connectionPhase ?? ABSENT_CONNECTION_PHASE,
      }
    }
    const reflect = this.ctx.reflect as unknown as {
      _getImpl(name: string, strict?: boolean): unknown
      provide(name: string, value?: unknown): unknown
      set(name: string, value: unknown): boolean
    }
    if (reflect._getImpl(name, false)) reflect.set(name, value)
    else reflect.provide(name, value)
  }

  /**
   * Declare the root slot's children and let the auto frame render them.
   * @param children - slot specs (`{ sidebar: { kind: 'single', scope: 'root' } }`).
   * @returns completion of the registration.
   */
  async declare(children: SlotTestChildren): Promise<void> {
    this.registerRoot(children, SlotTestFrame)
  }

  /**
   * Mount one client package entry (its inject list plus apply) on the root.
   * @param entry - the package's `{ inject, apply }` face.
   * @returns the settled fiber.
   */
  async mount(entry: SlotTestEntry): Promise<Fiber> {
    const fiber = this.ctx.plugin({
      name: entry.name ?? 'test-runtime: entry',
      inject: entry.inject as never,
      apply: entry.apply as never,
    } as never)
    const settled = await fiber
    this.fibers.push(settled)
    return settled
  }

  /**
   * Render the root slot, materializing the renderer host face.
   * @param owner - root owner props (production passes `{}`).
   * @returns the render handle.
   */
  renderRoot(owner: SlotTestOwner = {}): SlotTestView {
    return this.openView(() => this.slots.renderSlot('root', owner as never))
  }

  /**
   * Render one child slot in a tree of its own, through the declaring frame.
   * @param key - the declared child slot.
   * @param owner - owner props the entry receives.
   * @returns the render handle; `update` re-renders this slot in place.
   */
  renderSlot(key: string, owner: SlotTestOwner = {}): SlotTestView {
    let current = owner
    return this.openView(
      () => this.slots.renderSlot(
        'root',
        { [TEST_SLOT]: { key, owner: current } } as never,
      ),
      next => {
        current = next
      },
    )
  }

  /**
   * Resolve the store instance behind a registered entry, the way the outlet
   * does (session-scoped stores key off `sessionId`, root-scoped ones ignore it).
   * @param key - slot key.
   * @param sessionId - scope key for session-scoped stores.
   * @returns the live store instance.
   */
  storeOf(key: string, sessionId?: SessionId): StoreInstanceLike | undefined {
    const host = this.hostOf()
    const entries = host.entriesOf(key)
    if (entries.length === 0) throw new Error(`storeOf: slot "${key}" is not registered`)
    for (const entry of entries) {
      const instance = host.storeOf(entry, sessionId)
      if (instance !== undefined) return instance
    }
    return undefined
  }

  /** The captured renderer host face (entries, specs, store resolution). */
  get host(): SlotRendererHost {
    return this.hostOf()
  }

  /**
   * Settle pending microtasks and effects.
   * @returns completion of the flush.
   */
  async flush(): Promise<void> {
    await act(async () => {
      await new Promise<void>(resolve => { setTimeout(resolve, 0) })
    })
  }

  /**
   * Tear the bench down: unmount trees, unload entries, dispose every fiber.
   * @returns completion of the teardown.
   */
  async dispose(): Promise<void> {
    await act(async () => {
      for (const view of this.views.splice(0)) view.unmount()
      this.rootDisposer?.()
      this.rootDisposer = undefined
      for (const fiber of this.fibers.splice(0)) await fiber.dispose()
      for (const id of [...this.sessions.list.getSnapshot().ids]) await this.sessions.remove(id)
      // The root context owns the registry fiber and every entry mounted on
      // it; disposing it settles the whole tree (idempotent per fiber).
      await (this.ctx as unknown as { fiber?: Fiber }).fiber?.dispose()
      await this.registryFiber?.dispose()
    })
  }

  /* ---------------------------------------------------------- internals */

  /** Occupy `root` with `component`, replacing any earlier bench declaration. */
  private registerRoot(children: SlotTestChildren, component: unknown): void {
    this.rootDisposer?.()
    this.rootDisposer = this.slots.register({ name: 'root', children } as never, component as never) as never
  }

  /** Fail loud when a spec reaches for the host before the first render. */
  private hostOf(): SlotRendererHost {
    if (this.hostFace === undefined) {
      throw new Error('storeOf before the first render: call renderRoot() or renderSlot() to materialize the host face')
    }
    return this.hostFace
  }

  /** Render one tree and wrap the handle with an in-place `update` seam. */
  private openView(node: () => ReactNode, onOwner?: (next: SlotTestOwner) => void): SlotTestView {
    const tree = () => createElement(Fragment, null, node())
    const view = render(tree())
    this.views.push(view)
    return {
      ...view,
      view,
      container: view.container,
      update: (next: SlotTestOwner) => {
        onOwner?.(next)
        void act(() => {
          view.rerender(tree())
        })
      },
    }
  }
}

/** One no-op root component slot for specs that declare without a frame. */
export const NULL_ROOT: () => null = () => null
