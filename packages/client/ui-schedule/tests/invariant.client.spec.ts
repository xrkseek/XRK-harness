import { Context } from '@xrkseek/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@xrkseek/xrk-invariants'
import * as ScheduleInvariant from '../src/invariant.ts'

describe('ui-schedule invariant companion', () => {
  it('registers the empty installer and keeps the node half inert', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(ScheduleInvariant).await()).resolves.toBeDefined()
    const { apply } = await import('../src/index.ts')
    apply()
    await ctx.fiber.dispose()
  })
})