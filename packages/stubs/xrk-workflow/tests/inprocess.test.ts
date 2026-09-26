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

  it('bridges createAgent across the worker boundary', async () => {
    const ctx = new Context()
    ;(ctx as { logger?: { warn: (m: string) => void } }).logger = {
      warn: vi.fn(),
    }
    const engine = new IsolatingWorkflowEngine(ctx, {
      createAgent: async (_req, call) => ({
        echoed: call.prompt,
        label: call.label,
      }),
    })
    const run = engine.start({
      script: `
        const a = await agent({ label: 'bridged', prompt: 'hello-iso' });
        return { a };
      `,
      meta: { name: 'iso-bridge', description: 'createAgent bridge' },
      parent: fakeParent(),
    })
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.agentsStarted).toBe(1)
    expect(result.value).toEqual({
      a: { echoed: 'hello-iso', label: 'bridged' },
    })
    await run.dispose()
  })

  it('surfaces createAgent failures into the script', async () => {
    const ctx = new Context()
    ;(ctx as { logger?: { warn: (m: string) => void } }).logger = {
      warn: vi.fn(),
    }
    const engine = new IsolatingWorkflowEngine(ctx, {
      createAgent: async () => {
        throw new Error('bridge boom')
      },
    })
    const run = engine.start({
      script: `
        try {
          await agent({ label: 'x', prompt: 'y' });
          return { ok: true };
        } catch (e) {
          return { ok: false, msg: String(e && e.message ? e.message : e) };
        }
      `,
      meta: { name: 'iso-fail', description: 'createAgent fail' },
      parent: fakeParent(),
    })
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.value).toEqual({ ok: false, msg: 'bridge boom' })
    await run.dispose()
  })

  it('awaits tools.name(args) across the worker boundary', async () => {
    const ctx = new Context()
    ;(ctx as { logger?: { warn: (m: string) => void } }).logger = {
      warn: vi.fn(),
    }
    const engine = new IsolatingWorkflowEngine(ctx, {
      toolBridge: {
        listNames: () => ['echo_tool'],
        call: async (name, args) => {
          const text = (args as { text?: string } | null)?.text ?? ''
          return { content: `echo:${name}:${text}` }
        },
      },
    })
    const run = engine.start({
      script: `
        const v = await tools.echo_tool({ text: 'ping' });
        return { v };
      `,
      meta: { name: 'iso-tools', description: 'tools.* bridge' },
      parent: fakeParent(),
    })
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.value).toEqual({ v: 'echo:echo_tool:ping' })
    await run.dispose()
  })

  it('rejects unknown tools.name from the worker', async () => {
    const ctx = new Context()
    ;(ctx as { logger?: { warn: (m: string) => void } }).logger = {
      warn: vi.fn(),
    }
    const engine = new IsolatingWorkflowEngine(ctx, {
      toolBridge: {
        listNames: () => ['echo_tool'],
        call: async () => ({ content: 'nope' }),
      },
    })
    const run = engine.start({
      script: `
        try {
          await tools.missing({});
          return { ok: true };
        } catch (e) {
          return { ok: false, msg: String(e && e.message ? e.message : e) };
        }
      `,
      meta: { name: 'iso-tools-miss', description: 'unknown tool' },
      parent: fakeParent(),
    })
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.value).toMatchObject({ ok: false })
    expect(String((result.value as { msg: string }).msg)).toMatch(/unknown tool/)
    await run.dispose()
  })
})

describe('InProcessWorkflowEngine tools.*', () => {
  it('awaits tools.name(args) in-process', async () => {
    const ctx = new Context()
    ;(ctx as { logger?: { warn: (m: string) => void } }).logger = {
      warn: vi.fn(),
    }
    const engine = new InProcessWorkflowEngine(ctx, {
      toolBridge: {
        listNames: () => ['echo_tool'],
        call: async (_name, args) => ({
          content: `echo:${(args as { text?: string }).text ?? ''}`,
        }),
      },
    })
    const run = engine.start({
      script: `
        const v = await tools.echo_tool({ text: 'hi' });
        return { v };
      `,
      meta: { name: 'inproc-tools', description: 'tools.*' },
      parent: fakeParent(),
    })
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.value).toEqual({ v: 'echo:hi' })
    await run.dispose()
  })
})
