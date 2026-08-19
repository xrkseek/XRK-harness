/**
 * Face Client Remote gateway: `$on` / `$dispatch` / Face-native `$bindFace`.
 * Calls go through `connection.rpc.call('/api', ns/method, { args })`.
 * Not the DSH generated-codec gateway.
 */

import { Service } from '@xrkseek/cordis'
import type { Context } from '@xrkseek/cordis'
import type {
  RemoteResult,
  TypertDisposer,
  TypertRemoteContribution,
} from '@xrkseek/xrk-typert-protocol'
import { packRemoteArgs, type FaceArgSpec } from './pack.ts'

/** One Face namespace: method name → positional wire fields, or `'args'` bag. */
export type FaceRemoteSpec = Record<string, Record<string, FaceArgSpec>>

interface ConnectionRpc {
  call(
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<RemoteResult<unknown>>
}

interface ConnectionHandle {
  readonly rpc: ConnectionRpc
}

type RemoteEventListener = (...args: never[]) => void

interface RemoteEventSubscription {
  readonly listener: RemoteEventListener
}

declare module '@xrkseek/cordis' {
  interface Context {
    remote: FaceClientRemote
  }
}

/** Required Client services: Typert registry and the Connection carrier. */
export const inject = ['typert', 'connection']

/**
 * Install the Face Client Remote service.
 * @param ctx - Client Cordis root.
 */
export function apply(ctx: Context): void {
  new FaceClientRemote(ctx)
}

/** Typed Remote service plus Face `$bindFace` used by api-remotes. */
export class FaceClientRemote extends Service {
  private readonly subscriptions = new Map<string, RemoteEventSubscription[]>()

  constructor(ctx: Context) {
    super(ctx, 'remote')
    ctx.effect(() => () => { this.subscriptions.clear() }, 'api-gateway.client.subscriptions')
  }

  async $mount(_contribution: TypertRemoteContribution): Promise<TypertDisposer> {
    return async () => undefined
  }

  /**
   * Mount Face-native Remote namespaces (no generated descriptors).
   * Called by `@xrkseek/xrk-api-remotes` so `remote.commands` exists
   * before runtime apply.
   */
  async $bindFace(spec: FaceRemoteSpec): Promise<void> {
    const caller = this.ctx
    for (const [namespace, methods] of Object.entries(spec)) {
      const fiber = caller.plugin({
        name: `remote.${namespace}`,
        apply: (scope: Context) => {
          const api = this.namespaceApi(scope, namespace, methods)
          scope.provide(`remote.${namespace}`, api)
          Object.defineProperty(this, namespace, {
            value: api,
            writable: true,
            configurable: true,
            enumerable: true,
          })
        },
      })
      await fiber
    }
  }

  $on(event: string, listener: (...args: never[]) => void): () => void {
    const subscription: RemoteEventSubscription = { listener }
    const owned = this.ctx.effect(() => {
      const listeners = this.listeners(String(event))
      listeners.push(subscription)
      return () => {
        const at = listeners.indexOf(subscription)
        if (at >= 0) listeners.splice(at, 1)
      }
    }, `api-gateway.client.$on(${JSON.stringify(event)})`)
    return () => { void owned() }
  }

  $dispatch(event: string, args: readonly unknown[]): void {
    const listeners = this.subscriptions.get(event)
    if (listeners === undefined) return
    for (const { listener } of [...listeners]) {
      const report = (error: unknown): void => {
        console.error(`client api: Remote event ${JSON.stringify(event)} listener threw:`, error)
      }
      try {
        const settled: unknown = listener(...args as never[])
        if (settled instanceof Promise) settled.catch(report)
      } catch (error) {
        report(error)
      }
    }
  }

  private listeners(event: string): RemoteEventSubscription[] {
    let listeners = this.subscriptions.get(event)
    if (listeners === undefined) {
      listeners = []
      this.subscriptions.set(event, listeners)
    }
    return listeners
  }

  private namespaceApi(
    scope: Context,
    namespace: string,
    methods: Record<string, FaceArgSpec>,
  ): Record<string, (...values: never[]) => Promise<RemoteResult<unknown>>> {
    const api: Record<string, (...values: never[]) => Promise<RemoteResult<unknown>>> = {}
    for (const [method, spec] of Object.entries(methods)) {
      api[method] = (...values: never[]) => this.invoke(scope, namespace, method, spec, values)
    }
    return api
  }

  private async invoke(
    scope: Context,
    namespace: string,
    method: string,
    spec: FaceArgSpec,
    values: readonly unknown[],
  ): Promise<RemoteResult<unknown>> {
    const endpoint = `${namespace}/${method}`
    const connection = scope.get('connection') as ConnectionHandle | undefined
    if (connection === undefined) {
      return {
        ok: false,
        error: {
          code: 'carrier-failure',
          message: `client api: ${endpoint} has no active Connection`,
          details: {},
        },
      }
    }
    try {
      const result = await connection.rpc.call('/api', endpoint, {
        args: packRemoteArgs(spec, values),
      })
      if (!result.ok) {
        return {
          ok: false,
          error: {
            code: result.error.code,
            message: result.error.message,
            details: 'details' in result.error ? result.error.details : {},
          },
        }
      }
      return { ok: true, value: result.value }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'carrier-failure',
          message: error instanceof Error ? error.message : String(error),
          details: {},
        },
      }
    }
  }
}
