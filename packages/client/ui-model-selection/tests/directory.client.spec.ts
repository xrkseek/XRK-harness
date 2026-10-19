/**
 * ModelDirectory load/select cadence: soft-refresh must not flash `loading`
 * over a paintable catalog, and select must echo the pending route so the
 * composer seat checkmark moves on the click.
 */
import { describe, expect, it } from 'vitest'
import type { ModelSelection, SessionId, SessionModels } from '@xrkseek/xrk-api-remotes/client'
import { ModelDirectory } from '../src/client/directory.ts'

const sid = 's1' as SessionId

const catalog: SessionModels = {
  current: { provider: 'deepseek-official', model: 'deepseek-flash' },
  routable: true,
  groups: [{
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [
      { id: 'deepseek-flash', name: 'Flash' },
      { id: 'deepseek-v4-pro', name: 'Pro' },
    ],
  }],
  failures: [],
}

function okModels(value: SessionModels = catalog) {
  return Promise.resolve({ result: { ok: true as const, value } })
}

function okSelect(selected: ModelSelection) {
  return Promise.resolve({ result: { ok: true as const, value: { selected } } })
}

describe('ModelDirectory soft-refresh + optimistic select', () => {
  it('keeps status ready while refreshing a paintable catalog', async () => {
    let release!: (value: Awaited<ReturnType<typeof okModels>>) => void
    const sessions = {
      models: () => okModels(),
      selectModel: () => okSelect(catalog.current),
    }
    const directory = new ModelDirectory(sessions, sid, () => true)
    await directory.load()
    expect(directory.store.getSnapshot().status).toBe('ready')

    sessions.models = () => new Promise((resolve) => { release = resolve })
    const pending = directory.load()
    expect(directory.store.getSnapshot()).toMatchObject({
      status: 'ready',
      groups: catalog.groups,
    })
    release(await okModels({
      ...catalog,
      current: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    }))
    await pending
    expect(directory.store.getSnapshot()).toMatchObject({
      status: 'ready',
      current: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    })
  })

  it('flips to loading only when nothing is paintable yet', async () => {
    let release!: (value: Awaited<ReturnType<typeof okModels>>) => void
    const sessions = {
      models: () => new Promise((resolve) => { release = resolve }),
      selectModel: () => okSelect(catalog.current),
    }
    const directory = new ModelDirectory(sessions, sid, () => true)
    const pending = directory.load()
    expect(directory.store.getSnapshot().status).toBe('loading')
    release(await okModels())
    await pending
    expect(directory.store.getSnapshot().status).toBe('ready')
  })

  it('echoes the pending selection while selectModel is in flight and rolls back on reject', async () => {
    type SelectReply = Awaited<ReturnType<typeof okSelect>> | {
      result: { ok: false; error: { code: string; message: string } }
    }
    let release!: (value: SelectReply) => void
    const sessions = {
      models: () => okModels(),
      selectModel: () => new Promise<SelectReply>((resolve) => { release = resolve }),
    }
    const directory = new ModelDirectory(sessions, sid, () => true)
    await directory.load()

    const next: ModelSelection = { provider: 'deepseek-official', model: 'deepseek-v4-pro' }
    const pending = directory.select(next)
    expect(directory.store.getSnapshot()).toMatchObject({
      status: 'selecting',
      current: next,
    })
    release({
      result: {
        ok: false as const,
        error: { code: 'model-unavailable', message: 'session already contains images' },
      },
    })
    await expect(pending).rejects.toThrow(/model-unavailable/)
    expect(directory.store.getSnapshot()).toMatchObject({
      status: 'error',
      current: catalog.current,
      error: 'model-unavailable: session already contains images',
    })
  })
})
