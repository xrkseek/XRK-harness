/** ui-theme apply wiring: service provision, settings dictionaries riding the
 * locale service, declaration-aware Appearance and font-size row registration,
 * snapshot projection into the row stores, and HMR collapse recovery. */
import { Context } from '@xrkseek/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@xrkseek/client-runtime/client'
import { LocaleRuntime } from '@xrkseek/client-locale/client'
import { TestRemote, usePinnedBrowserLanguages } from '@xrkseek/client-test-runtime'
import { SettingsScopeBinder } from '@xrkseek/client-ui-settings/client'
import { apply, inject, SETTINGS_NS } from '@xrkseek/client-ui-theme/client'
import type { AppearanceRowInjected, FontSizeRowInjected, ThemeRuntime } from '@xrkseek/client-ui-theme/client'
import { THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema } from '../src/theme-settings.ts'
import { AppearanceRow } from '../src/client/AppearanceRow.tsx'
import { FontSizeRow } from '../src/client/FontSizeRow.tsx'
import type { createAppearanceRowStore, createFontSizeRowStore } from '../src/client/settings-store.ts'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

const SLOT = 'settings.general.item'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function bench(isLoopback = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const section: Record<string, unknown> = { preference: 'system', fontSize: 14 }
  const namespace = () => ({
    ns: THEME_SETTINGS_NAMESPACE,
    schema: ThemeSettingsSchema.toJSON(),
    value: { ...section },
    applies: 'live' as const,
    secrets: [],
    revision: 0,
  })
  const describe = vi.fn(() => Promise.resolve({
    rpcId: 'theme-describe' as never,
    result: {
      ok: true as const,
      value: { writable: true, hasDocument: true, namespaces: [namespace()] },
    },
  }))
  const mutate = vi.fn((request: { ops: { path: string[]; value: unknown }[] }) => {
    const op = request.ops[0]!
    section[op.path[0]!] = op.value
    return Promise.resolve({
      rpcId: 'theme-mutate' as never,
      result: { ok: true as const, value: namespace() },
    })
  })
  ctx.provide('connection', { api: { settings: { describe, mutate } }, isLoopback } as never)
  // The settings transport and the forwarded-event port the plugin injects.
  new TestRemote(ctx)
  await ctx.plugin(SettingsScopeBinder).await()
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, locale, describe, mutate,
    setHostSection: (next: Record<string, unknown>) => { Object.assign(section, next) },
  }
}

/** Stand in for the settings shell: declare the General item slot from root. */
function declareItems(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

/** Mirror the framework's inject choreography: bake a real instance from the
 * declared handle and hand its actions to the entry's inject factory. */
function faceOf(slots: SlotRegistry) {
  const entry = slots.entries(SLOT).find(e => e.component === AppearanceRow)!
  const handle = entry.store as ReturnType<typeof createAppearanceRowStore>
  const instance = handle.create()
  const face = (entry.inject as unknown as (a: typeof instance.actions) => AppearanceRowInjected)(instance.actions)
  return { entry, instance, face }
}

/** The same choreography for the font-size row entry. */
function fontSizeFaceOf(slots: SlotRegistry) {
  const entry = slots.entries(SLOT).find(e => e.component === FontSizeRow)!
  const handle = entry.store as ReturnType<typeof createFontSizeRowStore>
  const instance = handle.create()
  const face = (entry.inject as unknown as (a: typeof instance.actions) => FontSizeRowInjected)(instance.actions)
  return { entry, instance, face }
}

describe('ui-theme apply', () => {
  it('declares the slot and locale services', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
  })

  it('provides the service, registers localized copy, and registers both rows (declaration before or after apply)', async () => {
    const before = await bench()
    declareItems(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.locale.bind(SETTINGS_NS)('appearance.title')).toBe('外观')
    expect(before.locale.bind(SETTINGS_NS)('fontSize.title')).toBe('字号大小')
    before.locale.setLocale('en')
    expect(before.locale.bind(SETTINGS_NS)('appearance.title')).toBe('Appearance')
    const entry = before.slots.entries(SLOT).find(e => e.component === AppearanceRow)!
    expect(entry.options).toMatchObject({ id: 'appearance', order: 10 })
    const fontEntry = before.slots.entries(SLOT).find(e => e.component === FontSizeRow)!
    expect(fontEntry.options).toMatchObject({ id: 'font-size', order: 11 })

    const after = await bench()
    const fiber = after.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(after.slots.entries(SLOT)).toHaveLength(0)
    declareItems(after.slots)
    await Promise.resolve()
    expect(after.slots.entries(SLOT).some(e => e.component === AppearanceRow)).toBe(true)
    expect(after.slots.entries(SLOT).some(e => e.component === FontSizeRow)).toBe(true)
  })

  it('projects service snapshots into the row stores and routes face writes back', async () => {
    const b = await bench()
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    // An event ahead of any inject hits the unbound-actions arm.
    theme.setTheme('dark')
    theme.setFontSize(16)

    const { instance, face } = faceOf(b.slots)
    // The inject-time re-sync sealed the init window: the mirror is current.
    expect(instance.getSnapshot().preference).toBe('dark')
    // Copy rides the standard locale seat: the entry declares the namespace.
    expect(b.slots.entries(SLOT).find(e => e.component === AppearanceRow)!.locale).toBe(SETTINGS_NS)

    face.setTheme('system')
    expect(theme.getTheme().preference).toBe('system')
    expect(instance.getSnapshot().preference).toBe('system')

    const { instance: fontInstance, face: fontFace } = fontSizeFaceOf(b.slots)
    expect(fontInstance.getSnapshot().fontSize).toBe(16)
    fontFace.setFontSize(12)
    expect(theme.getTheme().fontSize).toBe(12)
    expect(fontInstance.getSnapshot().fontSize).toBe(12)
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalledTimes(4) })
  })

  it('loads Host settings at boot, refreshes its namespace, and keeps remote browsers process-local', async () => {
    const b = await bench()
    b.setHostSection({ preference: 'dark', fontSize: 17 })
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    await vi.waitFor(() => {
      expect(theme.getTheme().preference).toBe('dark')
      expect(theme.getTheme().fontSize).toBe(17)
    })
    b.ctx.remote.$dispatch('settings/document-updated', ['unrelated', 0])
    expect(b.describe).toHaveBeenCalledOnce()
    b.setHostSection({ preference: 'light', fontSize: 14 })
    b.ctx.remote.$dispatch('settings/document-updated', [THEME_SETTINGS_NAMESPACE, 0])
    await vi.waitFor(() => { expect(theme.getTheme().preference).toBe('light') })
    b.setHostSection({ preference: 'dark', fontSize: 17 })
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(theme.getTheme().preference).toBe('dark') })

    const remote = await bench(false)
    declareItems(remote.slots)
    await remote.ctx.plugin({ inject: [...inject], apply }).await()
    const remoteTheme = remote.ctx.get('theme') as ThemeRuntime
    remoteTheme.setTheme('dark')
    await Promise.resolve()
    expect(remote.describe).not.toHaveBeenCalled()
    expect(remote.mutate).not.toHaveBeenCalled()
  })

  it('activates before a slow initial settings read and converges when it settles', async () => {
    const b = await bench()
    b.setHostSection({ preference: 'dark' })
    const describe = b.describe.getMockImplementation()!
    const pending = deferred<Awaited<ReturnType<typeof describe>>>()
    b.describe.mockImplementationOnce(() => pending.promise)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    expect(theme.getTheme().preference).toBe('system')
    pending.resolve(await describe())
    await vi.waitFor(() => { expect(theme.getTheme().preference).toBe('dark') })
    await fiber.dispose()
  })

  it('ignores an invalid preference crossing the settings wire', async () => {
    const b = await bench()
    b.setHostSection({ preference: 'sepia' })
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledOnce() })
    expect(theme.getTheme().preference).toBe('system')
  })

  it('recovers after an HMR collapse of the declaring entry (stale disposer must not block)', async () => {
    const b = await bench()
    const host = declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries(SLOT)).toHaveLength(2)

    // Collapse: the declarer dies, the cascade removes our entry while the
    // apply closure still holds its (now stale) disposer.
    host()
    expect(b.slots.entries(SLOT)).toHaveLength(0)

    declareItems(b.slots)
    await Promise.resolve()
    expect(b.slots.entries(SLOT).some(e => e.component === AppearanceRow)).toBe(true)
    expect(b.slots.entries(SLOT).some(e => e.component === FontSizeRow)).toBe(true)
  })

  it('teardown removes the rows and the dictionaries; teardown without a declaration is quiet', async () => {
    const b = await bench()
    declareItems(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries(SLOT)).toHaveLength(2)
    await fiber.dispose()
    expect(b.slots.entries(SLOT)).toHaveLength(0)
    // Dictionary disposal: translation falls back to the bare key.
    expect(b.locale.bind(SETTINGS_NS)('appearance.title')).toBe('appearance.title')

    // Never-declared bench: the effect disposer's dispose arm stays undefined.
    const quiet = await bench()
    const f2 = quiet.ctx.plugin({ inject: [...inject], apply })
    await f2.await()
    await f2.dispose()
    expect(quiet.slots.entries(SLOT)).toHaveLength(0)
  })
})
