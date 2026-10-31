/**
 * DSH `configForms` seam for community theme clients (endfield, skin packs…).
 *
 * Modern DSH themes try `ctx.configForms.get(<profile-entry-id>)` first and
 * fall back to `settingsScope.bind`. XRK owns durable prefs on settingsScope;
 * this service is a thin alias so themes that prefer configForms still land
 * on the same Host document without embedding Cordis Config / configEditor.
 *
 * Shape kept intentionally small: get / describe (getSnapshot · subscribe ·
 * ensure) / whileServed / form getSnapshot · subscribe · set · unset · mutate.
 * Not a full DSH ConfigForm + SettingsDescribeMirror.
 */

import { Service } from '@xrkseek/cordis'
import type { Context } from '@xrkseek/cordis'
import type { ConnectionHandle } from '@xrkseek/xrk-api-remotes/client'
import type { SettingsScope } from '@xrkseek/client-runtime/client'
import type { SettingsScopeBinder } from './settings-scope.ts'

/** One form handle returned by {@link ConfigFormsService.get}. */
export interface ConfigFormHandle {
  getSnapshot(): ReturnType<SettingsScope<unknown>['getSnapshot']>
  subscribe(listener: () => void): () => void
  /** DSH ConfigForm.set resolves `boolean` (false = refused / memory skip). */
  set(field: string, value: unknown): Promise<boolean>
  unset(field: string): Promise<boolean>
  mutate(ops: readonly {
    readonly op: 'set' | 'unset'
    readonly path: readonly string[]
    readonly value?: unknown
  }[]): Promise<boolean>
}

/** Describe face community clients / plugin-manager call (subset of DSH mirror). */
export interface ConfigFormsDescribeFace {
  getSnapshot(): {
    readonly view: {
      readonly namespaces: readonly { readonly ns: string }[]
    }
  }
  subscribe(listener: () => void): () => void
  /** Pull Host `settings.describe` once so community ns show up before get(). */
  ensure(): Promise<void>
}

/** Shared-form service community clients look up as `configForms`. */
export interface ConfigFormsServiceApi {
  get(namespace: string): ConfigFormHandle
  describe(): ConfigFormsDescribeFace
  /**
   * Run `register` while any watched namespace is known (local get or Host
   * describe). Thin stand-in for DSH `whileServed`.
   */
  whileServed(
    namespaces: readonly string[],
    register: (served: ReadonlySet<string>) => () => void,
  ): () => void
}

declare module '@xrkseek/cordis' {
  interface Context {
    configForms: ConfigFormsServiceApi
  }
}

function wrapScope(scope: SettingsScope<unknown>): ConfigFormHandle {
  return {
    getSnapshot: () => scope.getSnapshot(),
    subscribe: (listener) => scope.subscribe(listener),
    async set(field, value) {
      try {
        await scope.set(field, value)
        return scope.getSnapshot().writable
      } catch {
        return false
      }
    },
    async unset(field) {
      try {
        await scope.unset(field)
        return scope.getSnapshot().writable
      } catch {
        return false
      }
    },
    async mutate(ops) {
      try {
        const pathOps = ops.map((op) => (
          op.op === 'unset'
            ? { op: 'unset' as const, path: op.path }
            : { op: 'set' as const, path: op.path, value: op.value }
        ))
        await scope.patch(pathOps)
        return scope.getSnapshot().writable
      } catch {
        return false
      }
    },
  }
}

/**
 * Alias service: `get(ns)` binds the same Host namespace as settingsScope.
 */
export class ConfigFormsService extends Service implements ConfigFormsServiceApi {
  private readonly known = new Set<string>()
  private readonly hostKnown = new Set<string>()
  private readonly describeListeners = new Set<() => void>()

  /**
   * @param ctx - settings domain fiber (same as SettingsScopeBinder).
   */
  constructor(ctx: Context) {
    super(ctx, 'configForms')
  }

  /**
   * Open / reuse one namespace form.
   * @param namespace - profile entry id or legacy settings namespace.
   */
  get(namespace: string): ConfigFormHandle {
    const ns = String(namespace ?? '').trim()
    if (ns === '') {
      throw new Error('configForms.get: empty namespace')
    }
    const binder = this.ctx.get('settingsScope') as SettingsScopeBinder | undefined
    if (binder === undefined || typeof binder.bind !== 'function') {
      throw new Error('configForms.get: settingsScope unavailable')
    }
    const added = !this.known.has(ns)
    this.known.add(ns)
    if (added) this.emitDescribe()
    return wrapScope(binder.bind({ namespace: ns }))
  }

  /**
   * Mirror of DSH describe → namespaces opened via get() plus Host-served
   * community namespaces after {@link ConfigFormsDescribeFace.ensure}.
   */
  describe(): ConfigFormsDescribeFace {
    return {
      getSnapshot: () => ({
        view: { namespaces: this.listNamespaces() },
      }),
      subscribe: (listener) => {
        this.describeListeners.add(listener)
        return () => { this.describeListeners.delete(listener) }
      },
      ensure: async () => {
        await this.pullHostDescribe()
      },
    }
  }

  whileServed(
    namespaces: readonly string[],
    register: (served: ReadonlySet<string>) => () => void,
  ): () => void {
    let off: (() => void) | undefined
    const sync = (): void => {
      const served = new Set(this.listNamespaces().map((row) => row.ns))
      const watched = namespaces.some((namespace) => served.has(namespace))
      if (watched && off === undefined) off = register(served)
      else if (!watched && off !== undefined) {
        off()
        off = undefined
      }
    }
    const unsubscribe = this.describe().subscribe(sync)
    void this.describe().ensure().then(sync)
    sync()
    return () => {
      unsubscribe()
      off?.()
      off = undefined
    }
  }

  private listNamespaces(): readonly { readonly ns: string }[] {
    const ids = new Set<string>([...this.known, ...this.hostKnown])
    return [...ids].sort().map((ns) => ({ ns }))
  }

  private emitDescribe(): void {
    for (const listener of this.describeListeners) listener()
  }

  private async pullHostDescribe(): Promise<void> {
    const connection = this.ctx.get('connection') as ConnectionHandle | undefined
    const describe = connection?.api?.settings?.describe
    if (typeof describe !== 'function') return
    try {
      const answer = await describe({}) as {
        readonly namespaces?: readonly { readonly ns?: string }[]
      }
      const rows = answer?.namespaces
      if (!Array.isArray(rows)) return
      let changed = false
      for (const row of rows) {
        const ns = typeof row?.ns === 'string' ? row.ns.trim() : ''
        if (ns === '' || this.hostKnown.has(ns)) continue
        this.hostKnown.add(ns)
        changed = true
      }
      if (changed) this.emitDescribe()
    } catch {
      // Host unreachable — keep local known set only.
    }
  }
}
