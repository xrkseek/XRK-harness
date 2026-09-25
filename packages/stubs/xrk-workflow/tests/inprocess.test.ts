import { describe, expect, it, vi } from 'vitest'
import { Context } from '@xrkseek/cordis'
import {
  InProcessWorkflowEngine,
  IsolatingWorkflowEngine,
  type WorkflowStartRequest,
} from '../src/index.ts'

function fakeParent(): WorkflowStartRequest['parent'] {
  return { session: { id: 'parent-session' } } as WorkflowStartRequest['parent']
}

describe('InProcessWorkflowEngine', () => {
  it('runs a script to completion and counts agent() calls', async () => {
    const ctx = new Context()
    ;(ctx as { logger?: { warn: (m: string) => void } }).logger = {
      warn: vi.fn(),
    }
    const engine = new InProcessWorkflowEngine(ctx)
    const run = engine.start({
      script: `
        phase('one');
        log('hi');
        const a = await agent({ label: 'w', prompt: 'do' });
        return { a, ok: true };
      `,
      meta: { name: 'demo', description: 'demo workflow' },
      parent: fakeParent(),
    })
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.agentsStarted).toBe(1)
    expect(result.value).toEqual({ a: null, ok: true })
    await run.dispose()
  })

  it('rejects missing meta.name synchronously', () => {
    const ctx = new Context()
    ;(ctx as { logger?: { warn: (m: string) => void } }).logger = {
      warn: vi.fn(),
    }
    const engine = new InProcessWorkflowEngine(ctx)
    expect(() =>
      engine.start({
        script: 'return 1',
        meta: { name: '', description: 'x' },
        parent: fakeParent(),
      }),
    ).toThrow(/meta\.name/)
  })
})

describe('IsolatingWorkflowEngine', () => {
  it('runs the script body in a worker thread', async () => {
    const ctx = new Context()
    ;(ctx as { logger?: { warn: (m: string) => void } }).logger = {
      warn: vi.fn(),
    }
    const engine = new IsolatingWorkflowEngine(ctx)
    const run = engine.start({
      script: `
        phase('iso');
        log('worker');
        const a = await agent({ label: 'iso-w', prompt: 'x' });
        return { a, ok: true, n: 1 + 1 };
      `,
      meta: { name: 'iso', description: 'isolating demo' },
      parent: fakeParent(),
    })
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.agentsStarted).toBe(1)
    expect(result.value).toEqual({ a: null, ok: true, n: 2 })
    await run.dispose()
  })
})
