/**
 * The settings domain base plugin's own mounting behavior: it stands up
 * `ctx.settingsScope` for every feature that owns a preference row, and the
 * service retires with its fiber.
 */
import { Context } from '@xrkseek/cordis'
import { describe, expect, it } from 'vitest'
import {
  apply, inject, SettingsNavBinder, SettingsScopeBinder,
} from '../src/client/index.ts'

/** Boot the browser half over a bare root context; it injects nothing. */
function bench() {
  const ctx = new Context()
  return { ctx, fiber: ctx.plugin({ inject: [...inject], apply }) }
}

describe('settings domain base plugin', () => {
  it('mounts the scope and nav services', async () => {
    const { ctx, fiber } = bench()
    await fiber.await()
    expect(ctx.get('settingsScope')).toBeInstanceOf(SettingsScopeBinder)
    expect(ctx.get('settingsNav')).toBeInstanceOf(SettingsNavBinder)
  })

  it('fiber disposal retires the services', async () => {
    const { ctx, fiber } = bench()
    await fiber.await()
    await fiber.dispose()
    expect(ctx.get('settingsScope')).toBeUndefined()
    expect(ctx.get('settingsNav')).toBeUndefined()
  })
})
