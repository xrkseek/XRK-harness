/**
 * The settings domain base plugin's own mounting behavior: it stands up
 * `ctx.settingsScope` for every feature that owns a preference row, and the
 * service retires with its fiber.
 */
import { Context } from '@xrkseek/cordis'
import { describe, expect, it } from 'vitest'
import {
  apply, ConfigFormsService, inject, SettingsNavBinder, SettingsScopeBinder,
} from '../src/client/index.ts'

/** Boot the browser half over a bare root context; it injects nothing. */
function bench() {
  const ctx = new Context()
  return { ctx, fiber: ctx.plugin({ inject: [...inject], apply }) }
}

describe('settings domain base plugin', () => {
  it('mounts the scope, configForms alias, and nav services', async () => {
    const { ctx, fiber } = bench()
    await fiber.await()
    expect(ctx.get('settingsScope')).toBeInstanceOf(SettingsScopeBinder)
    expect(ctx.get('configForms')).toBeInstanceOf(ConfigFormsService)
    expect(ctx.get('settingsNav')).toBeInstanceOf(SettingsNavBinder)
  })

  it('configForms.get mirrors settingsScope namespaces for theme clients', async () => {
    const { ctx, fiber } = bench()
    await fiber.await()
    const forms = ctx.get('configForms') as ConfigFormsService
    const form = forms.get('theme-endfield')
    expect(typeof form.getSnapshot).toBe('function')
    expect(typeof form.subscribe).toBe('function')
    expect(typeof form.set).toBe('function')
    const described = forms.describe()
    expect(typeof described.ensure).toBe('function')
    expect(typeof described.subscribe).toBe('function')
    await described.ensure()
    expect(described.getSnapshot().view.namespaces.map((row) => row.ns)).toContain('theme-endfield')
  })

  it('configForms.whileServed registers when a watched namespace is opened', async () => {
    const { ctx, fiber } = bench()
    await fiber.await()
    const forms = ctx.get('configForms') as ConfigFormsService
    let live = false
    const stop = forms.whileServed(['theme-endfield'], () => {
      live = true
      return () => { live = false }
    })
    expect(live).toBe(false)
    forms.get('theme-endfield')
    expect(live).toBe(true)
    stop()
    expect(live).toBe(false)
  })

  it('fiber disposal retires the services', async () => {
    const { ctx, fiber } = bench()
    await fiber.await()
    await fiber.dispose()
    expect(ctx.get('settingsScope')).toBeUndefined()
    expect(ctx.get('configForms')).toBeUndefined()
    expect(ctx.get('settingsNav')).toBeUndefined()
  })
})
