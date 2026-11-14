import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginAddingProviderForm,
  beginDeclaringProviderForm,
  clearProviderFormSession,
  getProviderFormSession,
  patchAddingProviderForm,
  patchDeclaringProviderForm,
  resetProviderFormSessionForTests,
  snapshotProviderFormSession,
  subscribeProviderFormSession,
} from '../src/client/provider-form-session.ts'

afterEach(() => {
  resetProviderFormSessionForTests()
})

describe('provider-form-session', () => {
  it('holds catalog-add draft across clear-free remounts', () => {
    beginAddingProviderForm({
      provider: 'deepseek',
      displayName: 'DeepSeek',
      settingsNs: 'llm-deepseek',
      settingsPath: [],
    })
    patchAddingProviderForm({
      draft: { baseURL: 'https://api.deepseek.com' },
      keyDraft: 'sk-test',
    })

    const snap = getProviderFormSession()
    expect(snap.kind).toBe('adding')
    if (snap.kind !== 'adding') return
    expect(snap.draft.baseURL).toBe('https://api.deepseek.com')
    expect(snap.keyDraft).toBe('sk-test')
    expect(snap.target.provider).toBe('deepseek')
  })

  it('holds custom-create draft fields', () => {
    beginDeclaringProviderForm({ protocol: 'openai-completions' })
    patchDeclaringProviderForm({
      route: 'acme',
      displayName: 'Acme',
      baseURL: 'https://acme.test/v1',
      keyDraft: 'sk-acme',
      models: [{ id: 'm1' }],
    })

    const snap = getProviderFormSession()
    expect(snap.kind).toBe('declaring')
    if (snap.kind !== 'declaring') return
    expect(snap.route).toBe('acme')
    expect(snap.models).toEqual([{ id: 'm1' }])
  })

  it('clears on cancel / success', () => {
    beginDeclaringProviderForm({ route: 'x' })
    clearProviderFormSession()
    expect(getProviderFormSession().kind).toBe('idle')
  })

  it('replaces adding with declaring (one card)', () => {
    beginAddingProviderForm({
      provider: 'a',
      displayName: 'A',
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', 'a'],
    })
    beginDeclaringProviderForm({ route: 'b' })
    expect(getProviderFormSession().kind).toBe('declaring')
  })

  it('skips emit when adding patch is unchanged', () => {
    beginAddingProviderForm({
      provider: 'a',
      displayName: 'A',
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', 'a'],
    })
    patchAddingProviderForm({ draft: { x: 1 }, keyDraft: 'k' })
    const listener = vi.fn()
    const unsub = subscribeProviderFormSession(listener)
    patchAddingProviderForm({ draft: { x: 1 }, keyDraft: 'k' })
    expect(listener).not.toHaveBeenCalled()
    unsub()
  })

  it('skips emit when declaring patch is unchanged', () => {
    beginDeclaringProviderForm({ route: 'acme', models: [{ id: 'm' }] })
    const listener = vi.fn()
    const unsub = subscribeProviderFormSession(listener)
    patchDeclaringProviderForm({ route: 'acme', models: [{ id: 'm' }] })
    expect(listener).not.toHaveBeenCalled()
    unsub()
  })

  it('snapshot clones so later patches do not mutate the resume seed', () => {
    beginDeclaringProviderForm({
      route: 'acme',
      models: [{ id: 'm1', name: 'one' }],
    })
    const seed = snapshotProviderFormSession()
    expect(seed.kind).toBe('declaring')
    if (seed.kind !== 'declaring') return

    patchDeclaringProviderForm({
      route: 'other',
      models: [{ id: 'm2' }],
    })
    expect(seed.route).toBe('acme')
    expect(seed.models).toEqual([{ id: 'm1', name: 'one' }])

    seed.models[0]!.id = 'mutated'
    const live = getProviderFormSession()
    expect(live.kind).toBe('declaring')
    if (live.kind !== 'declaring') return
    expect(live.models[0]?.id).toBe('m2')
  })
})
