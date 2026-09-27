/**
 * Minimal browser-test doubles. Ports the dsh `client-test-runtime` helpers the
 * client specs need to assemble a client tree without the real package: a
 * translate stub, the observable->hook bridge, a browser-language pin, the
 * forwarded-event port, and a settings-scope stand-in.
 *
 * Every export here is a TEST double. It lives in a private placeholder stub
 * (`replace with real package or remap`) so `packages/client/*` specs stay
 * runnable until the real `@xrkseek/client-test-runtime` is published.
 */
import { vi } from 'vitest'

/**
 * The observable->hook bridge re-exports web-react's real binding so test
 * seats see exactly the production selector semantics (uSES + equality).
 */
export { bindSnapshotSelector } from '../../client/web-react/src/bind.ts'

/**
 * Build a translate stub resolving through `dicts` in order (namespace first,
 * then shared vocab), falling back to the key. Interpolates `{name}` params.
 * @param dicts - dictionaries consulted in order.
 * @returns a translate function assignable to locale `t` seats.
 */
export function makeTranslate(
  ...dicts
) {
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
      name in params ? String(params[name]) : match)
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
export function usePinnedBrowserLanguages(...tags) {
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
  constructor(ctx) {
    const listeners = new Map()
    ctx.provide('remote', {
      /**
       * Subscribe one listener to a forwarded event.
       * @param event - wire event name.
       * @param listener - invoked with the dispatched arguments.
       * @returns the disposer removing this listener.
       */
      $on: (event, listener) => {
        let seat = listeners.get(event)
        if (!seat) listeners.set(event, (seat = new Set()))
        seat.add(listener)
        return () => {
          seat.delete(listener)
        }
      },
      /**
       * Fan one event out to its listeners, in subscription order.
       * @param event - wire event name.
       * @param args - the arguments the wire event carried.
       */
      $dispatch: (event, args) => {
        for (const listener of [...(listeners.get(event) ?? [])]) listener(...args)
      },
    })
  }
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
export function stubSettingsScope(initial) {
  let snapshot = {
    status: 'loading',
    value: undefined,
    base: undefined,
    user: undefined,
    revision: undefined,
    writable: false,
    mode: 'host',
    ...initial,
  }
  const listeners = new Set()
  const set = vi.fn(() => Promise.resolve())
  const unset = vi.fn(() => Promise.resolve())
  return {
    scope: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
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
    publish: (next) => {
      snapshot = { ...snapshot, ...next }
      for (const listener of [...listeners]) listener()
    },
    /** @returns how many listeners still hold the scope. */
    listenerCount: () => listeners.size,
  }
}
