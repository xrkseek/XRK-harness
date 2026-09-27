/**
 * The two read-only mirror cards: Face `host` and Face `process-channels`.
 *
 * Neither namespace is a preference: the Host publishes what it is (its
 * address, workspace, applied Host plugins) and what it is wired to talk to
 * (spawn-time channels, IM vendor stubs, the resolved IM gateway mode), and
 * Face describes both with an empty-object schema because nothing in them can
 * be written. These specs pin the parts that schema cannot state — the row
 * projection a user reads, the decoder that stands in for the schema path, and
 * the fact that both cards reach the Advanced tab under their namespace key.
 */
// @vitest-environment jsdom
import { Context } from '@xrkseek/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@xrkseek/client-runtime/client'
import { SlotRegistry } from '@xrkseek/client-runtime/client'
import { LocaleRuntime } from '@xrkseek/client-locale/client'
import { SettingsScopeBinder } from '@xrkseek/client-ui-settings/client'
import { apply, inject } from '../src/client/index.ts'
import {
  HOST_NS,
  HostInfoCardController,
  decodeHostInfo,
  type HostInfoSection,
} from '../src/client/host-info-card-controller.ts'
import {
  PROCESS_CHANNELS_NS,
  ProcessChannelsCardController,
  decodeProcessChannels,
  type ProcessChannelsSection,
} from '../src/client/process-channels-card-controller.ts'

/** A ready scope snapshot carrying `value`, as the Host transport publishes one. */
function ready<T>(value: T): SettingsScopeSnapshot<T> {
  return {
    status: 'ready',
    value,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: false,
    mode: 'host',
  }
}

/** The state a scope is in before the Host has answered once. */
function loading<T>(): SettingsScopeSnapshot<T> {
  return {
    status: 'loading',
    value: undefined,
    base: undefined,
    user: undefined,
    revision: undefined,
    writable: false,
    mode: 'host',
  }
}

/**
 * A scope a spec drives by hand: the controllers only read the snapshot and
 * observe replacements, so this covers their whole contract without the wire.
 * @param initial - the snapshot the scope starts on.
 * @returns the scope and a publisher that notifies its subscribers.
 */
function drivenScope<T>(initial: SettingsScopeSnapshot<T>) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const scope: SettingsScope<T> = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: () => Promise.resolve(),
    unset: () => Promise.resolve(),
  }
  return {
    scope,
    publish(next: SettingsScopeSnapshot<T>): void {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
  }
}

describe('read-only section decoders', () => {
  it('passes a served section through and refuses everything that is not one', () => {
    expect(decodeHostInfo({ host: '127.0.0.1' })).toEqual({ host: '127.0.0.1' })
    expect(decodeProcessChannels({ imGatewayWired: 'sidecar' })).toEqual({ imGatewayWired: 'sidecar' })

    // The default schema path would resolve null/array through object
    // defaults; these decoders exist to refuse them instead.
    for (const wrong of [undefined, null, 'host', 42, ['host'], true]) {
      expect(decodeHostInfo(wrong)).toBeUndefined()
      expect(decodeProcessChannels(wrong)).toBeUndefined()
    }
  })
})

describe('Host runtime card', () => {
  it('stays unavailable until the namespace is served', () => {
    const { scope, publish } = drivenScope<HostInfoSection>(loading())
    const card = new HostInfoCardController(scope)

    expect(card.inject().hooks.hostInfoCard.getSnapshot())
      .toEqual({ available: false, rows: [] })

    publish(ready<HostInfoSection>({ host: '127.0.0.1', port: 8787 }))
    expect(card.inject().hooks.hostInfoCard.getSnapshot().available).toBe(true)
  })

  it('publishes the address, and marks the facts this Host does not report', () => {
    const { scope } = drivenScope<HostInfoSection>(ready({
      host: '127.0.0.1',
      port: 8787,
      workspaceRoot: 'C:/work',
      preset: 'harness',
      corsOrigin: '*',
      rateLimitPerMinute: 120,
      pluginsDir: 'C:/plugins',
      webDistConfigured: true,
      cordisHostApplied: ['@xrkseek/plugin-a', '@xrkseek/plugin-b'],
      workflowEngine: { provider: 'n8n' },
    }))
    const rows = new HostInfoCardController(scope).inject().hooks.hostInfoCard.getSnapshot().rows
    const byLabel = new Map(rows.map(row => [row.label, row]))

    expect(byLabel.get('hostAddress')?.value).toBe('127.0.0.1:8787')
    expect(byLabel.get('hostWorkspaceRoot')?.value).toBe('C:/work')
    expect(byLabel.get('hostPreset')?.value).toBe('harness')
    expect(byLabel.get('hostCorsOrigin')?.value).toBe('*')
    expect(byLabel.get('hostRateLimit')?.value).toBe('120')
    expect(byLabel.get('hostPluginsDir')?.value).toBe('C:/plugins')
    expect(byLabel.get('hostApplied')?.value).toBe('@xrkseek/plugin-a · @xrkseek/plugin-b')
    expect(byLabel.get('hostWorkflowEngine')?.value).toBe('n8n')
    // A closed set this package's copy owns: the row names a key, not text.
    expect(byLabel.get('hostWebDist')?.valueKey).toBe('hostWebDistBuilt')
  })

  it('falls back to the absent placeholder, including a Host-less address', () => {
    const { scope } = drivenScope<HostInfoSection>(ready({ webDistConfigured: false }))
    const rows = new HostInfoCardController(scope).inject().hooks.hostInfoCard.getSnapshot().rows
    const byLabel = new Map(rows.map(row => [row.label, row]))

    for (const label of ['hostAddress', 'hostWorkspaceRoot', 'hostPreset', 'hostCorsOrigin',
      'hostRateLimit', 'hostPluginsDir', 'hostApplied', 'hostWorkflowEngine'] as const) {
      expect(byLabel.get(label)?.value).toBe('—')
    }
    expect(byLabel.get('hostWebDist')?.valueKey).toBe('hostWebDistNone')
  })

  it('republishes when the scope changes underneath it', () => {
    const { scope, publish } = drivenScope<HostInfoSection>(ready({ host: 'a', port: 1 }))
    const store = new HostInfoCardController(scope).inject().hooks.hostInfoCard
    const before = store.getSnapshot()

    publish(ready<HostInfoSection>({ host: 'b', port: 2 }))
    const after = store.getSnapshot()

    expect(after).not.toBe(before)
    expect(after.rows[0]?.value).toBe('b:2')
  })
})

describe('process & IM channel card', () => {
  it('counts and names the channels the Host wired at spawn', () => {
    const { scope } = drivenScope<ProcessChannelsSection>(ready({
      process: [
        { pluginId: '@xrkseek/channel-matrix', channelId: 'matrix' },
        { displayName: 'Slack bridge' },
      ],
      im: [{ channelId: 'telegram' }],
      imGatewayWired: 'sidecar',
      note: 'fixed at spawn',
    }))
    const rows = new ProcessChannelsCardController(scope)
      .inject().hooks.processChannelsCard.getSnapshot().rows
    const byLabel = new Map(rows.map(row => [row.label, row]))

    expect(byLabel.get('channelsImGateway')?.valueKey).toBe('channelsImGatewaySidecar')
    // A row without a display name falls back to `pluginId:channelId`.
    expect(byLabel.get('channelsProcess')?.value).toBe('2 · @xrkseek/channel-matrix:matrix · Slack bridge')
    expect(byLabel.get('channelsIm')?.value).toBe('1 · telegram')
    expect(byLabel.get('channelsNote')?.value).toBe('fixed at spawn')
  })

  it('says none for an empty list and for a gateway mode it does not know', () => {
    const { scope } = drivenScope<ProcessChannelsSection>(ready({ imGatewayWired: 'something-new' }))
    const rows = new ProcessChannelsCardController(scope)
      .inject().hooks.processChannelsCard.getSnapshot().rows
    const byLabel = new Map(rows.map(row => [row.label, row]))

    expect(byLabel.get('channelsImGateway')?.valueKey).toBe('channelsNone')
    expect(byLabel.get('channelsProcess')?.valueKey).toBe('channelsNone')
    expect(byLabel.get('channelsIm')?.valueKey).toBe('channelsNone')
    expect(byLabel.get('channelsNote')?.value).toBe('—')
  })

  it('stays unavailable until the namespace is served', () => {
    const { scope } = drivenScope<ProcessChannelsSection>(loading())
    const card = new ProcessChannelsCardController(scope)

    expect(card.inject().hooks.processChannelsCard.getSnapshot())
      .toEqual({ available: false, rows: [] })
  })
})

/**
 * The `remote` seat the plugin injects, reduced to the forwarded-event pair it
 * uses. The stub test-runtime package this repository ships does not export a
 * remote double, so a spec that needs one states only what it needs.
 * @param ctx - context to provide the service on.
 * @returns a dispatcher for the events a spec wants to raise.
 */
function stubRemote(ctx: Context) {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>()
  ctx.provide('remote', {
    $on: (key: string, handler: (...args: unknown[]) => void) => {
      const set = handlers.get(key) ?? new Set<(...args: unknown[]) => void>()
      set.add(handler)
      handlers.set(key, set)
      return () => { set.delete(handler) }
    },
  } as never)
  return {
    dispatch(key: string, args: unknown[]): void {
      for (const handler of [...(handlers.get(key) ?? [])]) handler(...args)
    },
  }
}

/**
 * @param served - namespaces the Host describes; the cards only need the
 * connection to answer, so the section values are left empty here.
 */
async function bench(served: string[]) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  // Pins the active locale the way the ui-schedule specs do; the stub test
  // runtime this package's other specs call does not ship its helper.
  locale.setLocale('zh')
  const describeSettings = vi.fn(() => Promise.resolve({
    rpcId: 's',
    result: {
      ok: true,
      value: {
        writable: true,
        hasDocument: true,
        namespaces: served.map(ns => ({
          ns, schema: {}, value: {}, applies: 'live', secrets: [], revision: 0,
        })),
      },
    },
  }))
  stubRemote(ctx)
  ctx.provide('connection', {
    isLoopback: true,
    api: { settings: { describe: describeSettings } },
  } as never)
  await ctx.plugin(SettingsScopeBinder).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-plugins registration of the read-only cards', () => {
  it('keys both read-only mirrors on the namespace they read', async () => {
    const { ctx, slots } = await bench([HOST_NS, PROCESS_CHANNELS_NS])
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    await vi.waitFor(() => {
      expect(slots.entries('settings.plugin.advanced.item').map(entry => entry.options.key))
        .toEqual(['auto-review', 'memory-embed', HOST_NS, PROCESS_CHANNELS_NS])
    })
  })

  it('registers every mirror as a card whose face exposes one store', async () => {
    const { ctx, slots } = await bench([HOST_NS, PROCESS_CHANNELS_NS])
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    await vi.waitFor(() => { expect(slots.entries('settings.plugin.advanced.item')).toHaveLength(4) })
    for (const entry of slots.entries('settings.plugin.advanced.item')) {
      const face = (entry as { inject?: () => unknown }).inject?.() as { hooks: Record<string, unknown> }
      expect(Object.keys(face.hooks)).toHaveLength(1)
    }
  })

  it('leaves the advanced tab empty when this deployment composes no such Host', async () => {
    const { ctx, slots } = await bench([])
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    // Cards register by namespace key regardless of what is served; the tab's
    // served-namespace intersection is what keeps an unserved one off screen.
    await vi.waitFor(() => { expect(slots.entries('settings.plugin.advanced.item')).toHaveLength(4) })
    const tab = slots.entries('settings.plugins.tab').find(entry => entry.options.id === 'advanced')!
    const face = (tab.inject as unknown as () => {
      hooks: { advancedPlugins: { getSnapshot(): { namespaces: string[] } } }
    })()
    expect(face.hooks.advancedPlugins.getSnapshot().namespaces).toEqual([])
  })
})
