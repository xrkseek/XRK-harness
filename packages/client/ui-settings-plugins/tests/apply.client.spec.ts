/** What the browser half registers, and that it all leaves with the fiber. */

import { Context } from '@xrkseek/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@xrkseek/client-ui-slots'
import { SlotRegistry } from '@xrkseek/client-runtime/client'
import { LocaleRuntime } from '@xrkseek/client-locale/client'
import { SettingsScopeBinder } from '@xrkseek/client-ui-settings/client'
import { apply, inject } from '@xrkseek/client-ui-settings-plugins/client'
import type {
  ConfigurablePluginsTabFace, PluginsSettingsSectionInjected,
} from '@xrkseek/client-ui-settings-plugins/client'

/**
 * The `remote` seat this plugin injects, reduced to the one call the plugin
 * makes on it. The stub test-runtime package in this repository ships no
 * remote double, so the spec states only what it needs.
 * @param ctx - context to provide the service on.
 */
function stubRemote(ctx: Context): void {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>()
  ctx.provide('remote', {
    $on: (key: string, handler: (...args: unknown[]) => void) => {
      const set = handlers.get(key) ?? new Set<(...args: unknown[]) => void>()
      set.add(handler)
      handlers.set(key, set)
      return () => { set.delete(handler) }
    },
    // Same shape the connection sink forwards with: a key and its argument list.
    $dispatch: (key: string, args: unknown[]) => {
      for (const handler of [...(handlers.get(key) ?? [])]) handler(...args)
    },
  } as never)
}

/**
 * @param served - namespaces the Host describes; omitted answers a failed read,
 * which is what most of these specs want (no card has anything to render).
 */
async function bench(served?: string[]) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  // These specs assert the shipped Chinese copy, so they pin the locale rather
  // than the browser jsdom reports (the stub test-runtime package does not ship
  // the browser-language helper this file used to call).
  locale.setLocale('zh')
  const describeCredentials = vi.fn(() => Promise.resolve({ rpcId: 'c', result: { ok: false, error: {} } }))
  const describeSettings = vi.fn(() => Promise.resolve(served === undefined
    ? { rpcId: 's', result: { ok: false, error: {} } }
    : {
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
  // The section binds its scopes through the Settings surface's service, and
  // forwarded Host events reach it through the same `$dispatch` handoff the
  // connection sink makes.
  stubRemote(ctx)
  ctx.provide('connection', {
    isLoopback: true,
    api: {
      settings: { describe: describeSettings },
      credentials: { describe: describeCredentials },
    },
  } as never)
  await ctx.plugin(SettingsScopeBinder).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, describeCredentials, describeSettings }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-plugins apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
  })

  it('registers one Plugins section and declares the tab and card slots', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    const section = slots.entries('settings.section')[0]!
    expect(section.options).toMatchObject({ id: 'plugins', order: 15 })
    // The nav label is a locale-following thunk; owners resolve it at read time.
    expect(resolveSlotLabel(section.options.label)).toBe('插件')
    expect(slots.spec('settings.plugins.tab')).toMatchObject({ kind: 'list', scope: 'root' })
    const tab = slots.entries('settings.plugins.tab')[0]!
    expect(tab.options).toMatchObject({ id: 'configurable', order: 0 })
    expect(resolveSlotLabel(tab.options.label)).toBe('插件配置')
    expect(slots.spec('settings.plugin.item')).toMatchObject({ kind: 'keyed', scope: 'root' })
  })


  it('injects a live tab projection, the card directory, and one business face per card', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const section = slots.entries('settings.section')[0]!
    const sectionFace = (section.inject as unknown as () => PluginsSettingsSectionInjected)()
    const initialTabs = sectionFace.hooks.tabs.getSnapshot()
    expect(initialTabs).toEqual([
      { id: 'configurable', order: 0, label: '插件配置' },
      { id: 'advanced', order: 10, label: '高级' },
    ])
    expect(sectionFace.hooks.tabs.getSnapshot()).toBe(initialTabs)

    const listener = vi.fn()
    const unsubscribe = sectionFace.hooks.tabs.subscribe(listener)
    slots.register({ name: 'settings.plugins.tab', id: 'plain' } as never, () => null)
    expect(sectionFace.hooks.tabs.getSnapshot()).toEqual([
      { id: 'configurable', order: 0, label: '插件配置' },
      { id: 'plain', order: 0, label: '' },
      { id: 'advanced', order: 10, label: '高级' },
    ])
    unsubscribe()

    const tab = slots.entries('settings.plugins.tab')[0]!
    const tabFace = (tab.inject as unknown as () => ConfigurablePluginsTabFace)()
    expect(Object.keys(tabFace.hooks)).toEqual(['configurablePlugins'])
    for (const entry of slots.entries('settings.plugin.item')) {
      const face = (entry as { inject?: () => unknown }).inject?.() as { hooks: Record<string, unknown> }
      // Each card injects exactly one snapshot store plus its own actions.
      expect(Object.keys(face.hooks)).toHaveLength(1)
    }
  })

  it('registers SSH remote on General settings.general.item', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    slots.register({
      name: 'settings.section',
      id: 'general',
      order: 0,
      children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
    } as never, () => null)

    await ctx.plugin({ inject: [...inject], apply }).await()

    await vi.waitFor(() => {
      expect(slots.entries('settings.general.item').map(e => e.options.id)).toEqual([
        'ssh-remote',
      ])
    })
  })

  it('registers an Advanced tab with the cards it ships there', async () => {
    const { ctx, slots } = await bench(['auto-review'])
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const tabIds = slots.entries('settings.plugins.tab').map(e => e.options.id)
    expect(tabIds).toContain('advanced')
    await vi.waitFor(() => {
      expect(slots.entries('settings.plugin.advanced.item').map(e => e.options.key))
        .toEqual(['auto-review', 'memory-embed', 'host', 'process-channels'])
    })
  })

  it('keys each card it ships on the settings namespace that card edits', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    expect(slots.entries('settings.plugin.item').map(entry => entry.options.key))
      .toEqual([
        'mcp', 'web-search', 'bash', 'agent-loop', 'workspace-inject',
        'session-telemetry', 'sandbox', 'computer-use', 'browser', 'voice',
        'image-gen', 'video-gen', 'video-analyze', 'curated-memory',
        'a2a-inbound', 'external-agent', 'cron',
      ])
  })

  it('dispatches the served namespaces its cards claim, and no others', async () => {
    // ui-theme is served but belongs to another surface, and a deployment
    // composing no bash executor may omit `bash` entirely.
    const { ctx, slots } = await bench(['agent-loop', 'ui-theme', 'mcp'])
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const tab = slots.entries('settings.plugins.tab')[0]!
    const face = (tab.inject as unknown as () => ConfigurablePluginsTabFace)()
    await vi.waitFor(() => {
      expect(face.hooks.configurablePlugins.getSnapshot().namespaces)
        .toEqual(['mcp', 'agent-loop'])
    })
  })

  it('re-reads the served namespaces when the Host commits a settings document', async () => {
    // Which namespaces the Host serves is a registration fact the wire never
    // announces on its own, so the tab rides the invalidation that can
    // accompany a changed composition.
    const { ctx, slots, describeSettings } = await bench(['bash'])
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describeSettings).toHaveBeenCalled() })
    describeSettings.mockClear()

    ctx.remote.$dispatch('settings/document-updated', ['bash', 1])

    await vi.waitFor(() => { expect(describeSettings).toHaveBeenCalled() })
  })

  it('re-reads the served namespaces after a reconnect', async () => {
    const { ctx, slots, describeSettings } = await bench(['bash'])
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describeSettings).toHaveBeenCalled() })
    describeSettings.mockClear()

    ctx.emit('connection/reset')

    await vi.waitFor(() => { expect(describeSettings).toHaveBeenCalled() })
  })

  it('re-reads the credential when the Host reports the watched reference changed', async () => {
    const { ctx, slots, describeCredentials } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describeCredentials).toHaveBeenCalled() })
    describeCredentials.mockClear()

    // A key written on another surface changes no settings section, so this
    // event is the only thing that reaches the card.
    ctx.remote.$dispatch('credentials/updated', ['XRK_TAVILY_API_KEY'])

    await vi.waitFor(() => { expect(describeCredentials).toHaveBeenCalledTimes(1) })
  })

  it('ignores a credential change for a reference no card watches', async () => {
    const { ctx, slots, describeCredentials } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describeCredentials).toHaveBeenCalled() })
    describeCredentials.mockClear()

    ctx.remote.$dispatch('credentials/updated', ['SOME_OTHER_KEY'])
    await Promise.resolve()

    expect(describeCredentials).not.toHaveBeenCalled()
  })

  it('registers into a declaration that arrives after apply', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()

    declareRoot(slots)

    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
  })

  it('collapses every contribution on teardown', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('settings.plugin.item')).toHaveLength(17)

    await fiber.dispose()

    expect(slots.entries('settings.section')).toHaveLength(0)
    expect(slots.spec('settings.plugins.tab')).toBeUndefined()
    expect(slots.spec('settings.plugin.item')).toBeUndefined()
    expect(slots.spec('settings.plugin.advanced.item')).toBeUndefined()
  })
})
