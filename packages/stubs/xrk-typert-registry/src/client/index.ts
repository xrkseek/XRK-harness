/**
 * Face Client Typert registry: enough for runtime `contexts.registerClient`
 * and gateway identity lookup. Not the DSH generated-schema registry.
 */

import { Service } from '@xrkseek/cordis'
import type { Context } from '@xrkseek/cordis'
import type {
  TypertClientContextBinder,
  TypertDisposer,
  TypertHostContextProvider,
  TypertHostContextResolver,
  TypertLookupProvider,
  TypertLookupResolver,
  TypertRegistryListener,
  TypertRemoteContribution,
} from '@xrkseek/xrk-typert-protocol'

/** Required services: none; this is the Client reflection root. */
export const inject: string[] = []

/**
 * Install the Face Client Typert registry.
 * @param ctx - Client Cordis root.
 */
export function apply(ctx: Context): void {
  new FaceTypertRegistry(ctx)
}

function noopDisposer(): TypertDisposer {
  return () => undefined
}

class FaceTypertRegistry extends Service {
  readonly local = {
    get: () => undefined,
    hasSeen: () => false,
    list: () => [],
    subscribe: (_listener: TypertRegistryListener) => noopDisposer(),
  }

  readonly remotes = {
    register: (_contribution: TypertRemoteContribution) => noopDisposer(),
    get: () => undefined,
    list: () => [],
    subscribe: (_listener: TypertRegistryListener) => noopDisposer(),
  }

  readonly lookups = {
    register: (_key: string, _provider: TypertLookupProvider) => noopDisposer(),
    configure: (_key: string, _resolver: TypertLookupResolver) => noopDisposer(),
    get: () => undefined,
    definitions: () => [],
    keys: () => [],
    subscribe: (_listener: TypertRegistryListener) => noopDisposer(),
  }

  readonly contexts = {
    registerHost: (_key: string, _provider: TypertHostContextProvider) => noopDisposer(),
    configureHost: (_key: string, _resolver: TypertHostContextResolver) => noopDisposer(),
    registerClient: (key: string, binder: TypertClientContextBinder): TypertDisposer => {
      this.clientBinders.set(key, binder)
      return () => {
        if (this.clientBinders.get(key) === binder) this.clientBinders.delete(key)
      }
    },
    getHost: () => undefined,
    getClient: (key: string) => this.clientBinders.get(key),
    subscribe: (_listener: TypertRegistryListener) => noopDisposer(),
  }

  private readonly clientBinders = new Map<string, TypertClientContextBinder>()

  constructor(ctx: Context) {
    super(ctx, 'typert')
  }
}
