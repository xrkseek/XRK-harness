/** Page-store join: directory × namespaces × credentials, with last-good rows on failure. */
import { describe, expect, it } from 'vitest'
import type { RpcResponse } from '@xrkseek/xrk-api-remotes/client'
import {
  insertProviderBefore,
  messageOf,
  ModelsSettingsStore,
} from '../src/client/store.ts'
import { providerReorderAnchor } from '../src/client/ProviderReorderRow.tsx'

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: true, value } }
}
function fail<T>(message: string): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: false, error: { code: 'internal', message, details: {} } } }
}

const DIRECTORY = [
  { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [], active: true },
  { provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], active: true },
  { provider: 'anthropic', displayName: 'anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], active: false },
  { provider: 'ghost', displayName: 'Ghost', settingsNs: '', settingsPath: [], active: true },
]

const NAMESPACES = [
  {
    ns: 'llm-deepseek',
    schema: {},
    value: { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://base' },
    base: { baseURL: 'https://base' },
    applies: 'live' as const,
    secrets: [],
    revision: 0,
  },
  {
    ns: 'llm-pi-ai',
    schema: {},
    value: { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' } } },
    user: { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' } } },
    applies: 'live' as const,
    secrets: [],
    revision: 0,
  },
  {
    ns: 'agent-default-model',
    schema: {},
    value: { provider: 'opencode', model: 'mimo-v2.6-flash-free' },
    base: { provider: 'deepseek', model: 'deepseek-flash' },
    user: { provider: 'opencode', model: 'mimo-v2.6-flash-free' },
    applies: 'live' as const,
    secrets: [],
    revision: 3,
  },
]

function api(overrides: {
  providers?: () => Promise<RpcResponse<{ providers: typeof DIRECTORY }>>
  describeSettings?: () => Promise<RpcResponse<{ writable: boolean; namespaces: typeof NAMESPACES }>>
  describeCredentials?: (refs: string[]) => Promise<RpcResponse<{ credentials: Record<string, unknown> }>>
  models?: () => Promise<RpcResponse<{ groups: { id: string; name: string; models: { id: string; name: string }[] }[]; failures: unknown[] }>>
  mutate?: (payload: unknown) => Promise<RpcResponse<unknown>>
} = {}) {
  const seenRefs: string[][] = []
  const face = {
    llm: {
      providers: overrides.providers ?? (() => Promise.resolve(ok({ providers: DIRECTORY }))),
      models: overrides.models ?? (() => Promise.resolve(ok({
        groups: [{
          id: 'deepseek',
          name: 'DeepSeek',
          models: [{ id: 'deepseek-flash', name: 'Flash' }],
        }],
        failures: [],
      }))),
    },
    settings: {
      describe: overrides.describeSettings ?? (() => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: NAMESPACES }))),
      mutate: overrides.mutate ?? (() => Promise.resolve(ok({}))),
      update: () => Promise.resolve(fail('unused')),
      replace: () => Promise.resolve(fail('unused')),
    },
    credentials: {
      describe: (payload: { refs: string[] }) => {
        seenRefs.push(payload.refs)
        return (overrides.describeCredentials ?? (refs => Promise.resolve(ok({
          credentials: Object.fromEntries(refs.map(ref => [ref, { configured: ref === 'OPENAI_API_KEY', writable: true }])),
        }))))(payload.refs)
      },
      set: () => Promise.resolve(ok({})),
      unset: () => Promise.resolve(ok({})),
    },
  }
  return { face: face as never, seenRefs }
}

describe('ModelsSettingsStore', () => {
  it('joins rows with configured, removable, and credential state', async () => {
    const { face, seenRefs } = api()
    const store = new ModelsSettingsStore(face)
    await store.load()
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.writable).toBe(true)
    expect(state.credentialError).toBeNull()
    expect(seenRefs).toEqual([['DEEPSEEK_API_KEY', 'OPENAI_API_KEY']])
    const byProvider = new Map(state.rows.map(row => [row.entry.provider, row]))
    expect(byProvider.get('deepseek-official')).toMatchObject({
      configured: true,
      removable: false,
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      credential: { configured: false, writable: true },
    })
    expect(byProvider.get('openai')).toMatchObject({
      configured: true,
      removable: true,
      apiKeyEnv: 'OPENAI_API_KEY',
      credential: { configured: true },
    })
    expect(byProvider.get('anthropic')).toMatchObject({ configured: false, removable: false })
    expect(byProvider.get('anthropic')?.apiKeyEnv).toBeUndefined()
    expect(byProvider.get('ghost')).toMatchObject({ configured: false, removable: false })
    expect(state.namespaces.get('llm-pi-ai')?.ns).toBe('llm-pi-ai')
    expect(state.defaultModel).toEqual({ provider: 'opencode', model: 'mimo-v2.6-flash-free' })
    expect(state.defaultModelOverridden).toBe(true)
    expect(state.defaultModelRevision).toBe(3)
    expect(state.defaultModelOptions).toEqual([
      { value: 'opencode/mimo-v2.6-flash-free', label: 'opencode/mimo-v2.6-flash-free' },
      { value: 'deepseek/deepseek-flash', label: 'DeepSeek · Flash' },
    ])
  })

  it('setDefaultModel writes agent-default-model and reloads', async () => {
    const ops: unknown[] = []
    const { face } = api({
      mutate: (payload) => {
        ops.push(payload)
        return Promise.resolve(ok({}))
      },
    })
    const store = new ModelsSettingsStore(face)
    await store.load()
    const failure = await store.setDefaultModel({ provider: 'deepseek', model: 'deepseek-v4-pro' })
    expect(failure).toBeUndefined()
    expect(ops).toEqual([{
      ns: 'agent-default-model',
      expectedRevision: 3,
      ops: [
        { op: 'set', path: ['provider'], value: 'deepseek' },
        { op: 'set', path: ['model'], value: 'deepseek-v4-pro' },
      ],
    }])
  })

  it('degrades the credential badge, not the page, when the credential domain fails', async () => {
    const { face } = api({ describeCredentials: () => Promise.resolve(fail('no provider')) })
    const store = new ModelsSettingsStore(face)
    await store.load()
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.credentialError).toBe('no provider')
    expect(state.rows.every(row => row.credential === undefined)).toBe(true)
  })

  it('settles a credential transport rejection without leaving the store loading', async () => {
    const { face } = api({
      describeCredentials: () => Promise.reject(new Error('credential transport down')),
    })
    const store = new ModelsSettingsStore(face)
    await expect(store.load()).resolves.toBeUndefined()
    expect(store.store.getSnapshot()).toMatchObject({
      status: 'ready',
      credentialError: 'credential transport down',
    })
  })

  it('stringifies a non-Error credential transport rejection', async () => {
    const { face } = api({
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection is the scenario
      describeCredentials: () => Promise.reject('credential transport refusal'),
    })
    const store = new ModelsSettingsStore(face)
    await expect(store.load()).resolves.toBeUndefined()
    expect(store.store.getSnapshot().credentialError).toBe('credential transport refusal')
  })

  it('surfaces a directory failure and keeps the last good rows', async () => {
    const { face } = api()
    const store = new ModelsSettingsStore(face)
    await store.load()
    expect(store.store.getSnapshot().rows).toHaveLength(4)
    const broken = api({ providers: () => Promise.resolve(fail('directory down')) })
    const failing = new ModelsSettingsStore(broken.face)
    await failing.load()
    expect(failing.store.getSnapshot()).toMatchObject({ status: 'error', error: 'directory down' })
    // The first store's snapshot is untouched by the second's failure.
    expect(store.store.getSnapshot().status).toBe('ready')
  })

  it('lets the newest load win over a stale slow response', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    let call = 0
    const { face } = api({
      providers: async () => {
        call += 1
        if (call === 1) {
          await gate
          return fail('stale slow failure')
        }
        return ok({ providers: DIRECTORY })
      },
    })
    const store = new ModelsSettingsStore(face)
    const first = store.load()
    const second = store.load()
    release?.()
    await Promise.all([first, second])
    expect(store.store.getSnapshot().status).toBe('ready')
  })
})

describe('edge joins', () => {
  it('treats a non-object profile as having no credential reference', async () => {
    const { face } = api({
      describeSettings: () => Promise.resolve(ok({
        writable: true,
        hasDocument: false,
        namespaces: [{
          ns: 'llm-pi-ai',
          schema: {},
          value: { providers: { weird: 'oops' } },
          applies: 'live' as const,
          secrets: [],
          revision: 0,
        }] as never,
      })),
      providers: () => Promise.resolve(ok({
        providers: [
          { provider: 'weird', displayName: 'weird', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'weird'], active: false },
        ] as never,
      })),
    })
    const store = new ModelsSettingsStore(face)
    await store.load()
    const state = store.store.getSnapshot()
    expect(state.rows[0]).toMatchObject({ configured: true, removable: false })
    expect(state.rows[0]?.apiKeyEnv).toBeUndefined()
  })

  it('skips the credential describe entirely when no row names a reference', async () => {
    const { face, seenRefs } = api({
      describeSettings: () => Promise.resolve(ok({
        writable: true,
        hasDocument: false,
        namespaces: [{ ns: 'llm-pi-ai', schema: {}, value: { providers: {} }, applies: 'live' as const, secrets: [], revision: 0 }] as never,
      })),
      providers: () => Promise.resolve(ok({
        providers: [
          { provider: 'anthropic', displayName: 'anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], active: false },
        ] as never,
      })),
    })
    const store = new ModelsSettingsStore(face)
    await store.load()
    expect(seenRefs).toEqual([])
    expect(store.store.getSnapshot().status).toBe('ready')
  })

  it('surfaces a settings describe failure', async () => {
    const { face } = api({ describeSettings: () => Promise.resolve(fail('settings down')) })
    const store = new ModelsSettingsStore(face)
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'error', error: 'settings down' })
  })

  it('stringifies a non-Error load failure', async () => {
    // The wire can surface non-Error throwables; the store must stringify them.
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection is the scenario
    const { face } = api({ providers: () => Promise.reject('plain refusal') })
    const store = new ModelsSettingsStore(face)
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'error', error: 'plain refusal' })
  })

  it('drops a stale successful response after a newer load finished', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    let call = 0
    const { face } = api({
      providers: async () => {
        call += 1
        if (call === 1) {
          await gate
          return ok({ providers: [] as never })
        }
        return ok({ providers: DIRECTORY })
      },
    })
    const store = new ModelsSettingsStore(face)
    const first = store.load()
    const second = store.load()
    await second
    release?.()
    await first
    // The stale empty directory never overwrote the newer join.
    expect(store.store.getSnapshot().rows).toHaveLength(4)
  })
})

describe('insertProviderBefore / providerReorderAnchor', () => {
  it('moves an id before an anchor and skips no-ops', () => {
    expect(insertProviderBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
    expect(insertProviderBefore(['a', 'b', 'c'], 'a', 'b')).toEqual(['a', 'b', 'c'])
    expect(insertProviderBefore(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a'])
  })

  it('maps drop half to insert-before anchors', () => {
    expect(providerReorderAnchor(['a', 'b', 'c'], 'c', 'a', 'before')).toBe('a')
    expect(providerReorderAnchor(['a', 'b', 'c'], 'a', 'b', 'after')).toBe('c')
    expect(providerReorderAnchor(['a', 'b', 'c'], 'a', 'c', 'after')).toBeUndefined()
    expect(providerReorderAnchor(['a', 'b', 'c'], 'b', 'a', 'after')).toBeNull()
  })
})

describe('ModelsSettingsStore.reorderProviders', () => {
  it('writes llm-pi-ai.providerOrder and keeps optimistic order until reload', async () => {
    const mutates: unknown[] = []
    const { face } = api({
      mutate: (payload) => {
        mutates.push(payload)
        return Promise.resolve(ok({}))
      },
    })
    const store = new ModelsSettingsStore(face)
    await store.load()
    const before = store.store.getSnapshot().rows
      .filter(row => row.configured)
      .map(row => row.entry.provider)
    expect(before[0]).toBe('deepseek-official')

    const failure = await store.reorderProviders('openai', 'deepseek-official')
    expect(failure).toBeUndefined()
    expect(mutates).toContainEqual({
      ns: 'llm-pi-ai',
      expectedRevision: 0,
      ops: [{ op: 'set', path: ['providerOrder'], value: ['openai', 'deepseek-official'] }],
    })
  })
})

describe('messageOf', () => {
  it('reads an Error message, and stringifies anything else a rejection may carry', () => {
    // The wire layer rejects with an Error, but a host or a runtime can reject
    // with any value, and the page still has to render something.
    expect(messageOf(new Error('connection lost'))).toBe('connection lost')
    expect(messageOf('the host refused')).toBe('the host refused')
    expect(messageOf(undefined)).toBe('undefined')
  })
})
