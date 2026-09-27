/**
 * Browser half: the schedule tab is registered into `settings.plugins.tab` with
 * localized copy and an eager-but-inert cron data client.
 */
// @vitest-environment jsdom
import { Context } from '@xrkseek/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@xrkseek/client-locale/client'
import { SlotRegistry } from '@xrkseek/client-runtime/client'
import { resolveSlotLabel } from '@xrkseek/client-ui-slots'
import { apply, inject, NS } from '../src/client/index.ts'
import { ScheduleSettingsTab, type ScheduleSettingsTabInjected } from '../src/client/ScheduleSettingsTab.tsx'

afterEach(cleanup)

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  // Stand-in for the removed `usePinnedBrowserLanguages('zh-CN')` top-level
  // call (the stub package does not ship it): pin the active locale so label
  // thunks resolve through the zh dictionary instead of jsdom's en-US.
  locale.setLocale('zh')
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-schedule browser plugin', () => {
  it('declares only the services the tab registration needs', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers the localized task tab behind the shipped plugin tabs', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.plugins.tab')[0]!
    expect(entry.component).toBe(ScheduleSettingsTab)
    // After configurable (0) and the inventory / advanced tabs (10).
    expect(entry.options).toMatchObject({ id: 'schedule', order: 20 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('任务')

    const injected = (entry.inject as unknown as () => ScheduleSettingsTabInjected)()
    expect(typeof injected.api.listJobs).toBe('function')
    expect(typeof injected.api.listRuns).toBe('function')

    await b.ctx.fiber.dispose()
  })

  it('follows locale and follows the slot declarer across reloads', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(1) })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.plugins.tab')[0]!.options.label)).toBe('Tasks')

    stop()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')[0]?.component).toBe(ScheduleSettingsTab)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    // The dictionary namespace is released with the plugin.
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})
