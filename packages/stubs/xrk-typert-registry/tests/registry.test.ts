import { describe, expect, it } from 'vitest'
import { Context } from '@xrkseek/cordis'
import { apply } from '../src/client/index.ts'

describe('Face typert registry', () => {
  it('registerClient / getClient round-trip', () => {
    const ctx = new Context()
    apply(ctx)
    const typert = ctx.get('typert') as {
      contexts: {
        registerClient: (
          key: string,
          binder: { identity: (scope: Context) => unknown },
        ) => () => void
        getClient: (key: string) => { identity: (scope: Context) => unknown } | undefined
      }
    }
    const binder = { identity: () => 'agent-1' }
    const dispose = typert.contexts.registerClient('agent', binder)
    expect(typert.contexts.getClient('agent')?.identity(ctx)).toBe('agent-1')
    dispose()
    expect(typert.contexts.getClient('agent')).toBeUndefined()
  })
})
