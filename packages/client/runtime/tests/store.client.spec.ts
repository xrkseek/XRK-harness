import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, defineStore, shallowEqual } from '../src/client/contract/store.ts'

interface State {
  a: { n: number }
  b: { list: string[] }
}

const init = (): State => ({ a: { n: 1 }, b: { list: ['x'] } })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('createSnapshotStore', () => {
  it('applies update through a draft and preserves untouched branch references', () => {
    const store = createSnapshotStore(init())
    const before = store.getSnapshot()
    store.update((d) => { d.a.n = 2 })
    const after = store.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.a.n).toBe(2)
    expect(after.b).toBe(before.b)
  })

  it('notifies synchronously per update by default', () => {
    const store = createSnapshotStore(init())
    const seen: number[] = []
    store.subscribe(() => { seen.push(store.getSnapshot().a.n) })
    store.update((d) => { d.a.n = 2 })
    store.update((d) => { d.a.n = 3 })
    expect(seen).toEqual([2, 3])
  })

  it('unsubscribes listeners', () => {
    const store = createSnapshotStore(init())
    const spy = vi.fn()
    const off = store.subscribe(spy)
    store.update((d) => { d.a.n = 2 })
    off()
    store.update((d) => { d.a.n = 3 })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('replaces state wholesale via set and freezes it outside production', () => {
    const store = createSnapshotStore(init())
    const next = init()
    store.set(next)
    expect(store.getSnapshot()).toBe(next)
    expect(() => { (store.getSnapshot().a).n = 9 }).toThrow()
  })

  it('freezes update produce output outside production (immer dev freeze)', () => {
    const store = createSnapshotStore(init())
    store.update((d) => { d.a.n = 2 })
    expect(() => { (store.getSnapshot().a).n = 9 }).toThrow()
  })

  it('rehydrates primitive state whole, not spread into index keys', async () => {
    vi.useFakeTimers()
    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v) },
      removeItem: (k: string) => { backing.delete(k) },
    })
    const store = createSnapshotStore<string>('', { persist: { name: 'spec-draft' } })
    store.set('hello')
    await vi.advanceTimersByTimeAsync(200)
    const revived = createSnapshotStore<string>('', { persist: { name: 'spec-draft' } })
    expect(revived.getSnapshot()).toBe('hello')
    vi.useRealTimers()
  })

  it('persists to localStorage under the given name and rehydrates', async () => {
    vi.useFakeTimers()
    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v) },
      removeItem: (k: string) => { backing.delete(k) },
    })
    const store = createSnapshotStore(init(), { persist: { name: 'spec-store' } })
    store.update((d) => { d.a.n = 42 })
    expect(backing.has('spec-store')).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(backing.has('spec-store')).toBe(true)
    const revived = createSnapshotStore(init(), { persist: { name: 'spec-store' } })
    expect(revived.getSnapshot().a.n).toBe(42)
    vi.useRealTimers()
  })

  it('coalesces rapid persist writes and skips identical payloads', async () => {
    vi.useFakeTimers()
    const backing = new Map<string, string>()
    const setItem = vi.fn((k: string, v: string) => { backing.set(k, v) })
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem,
      removeItem: (k: string) => { backing.delete(k) },
    })
    const store = createSnapshotStore({ draft: '' }, { persist: { name: 'spec-coalesce' } })
    store.set({ draft: 'a' })
    store.set({ draft: 'ab' })
    store.set({ draft: 'abc' })
    expect(setItem).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(JSON.parse(backing.get('spec-coalesce')!)).toEqual({ draft: 'abc' })
    store.set({ draft: 'abc' })
    await vi.advanceTimersByTimeAsync(200)
    expect(setItem).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})

describe('defineStore', () => {
  const declare = () => defineStore({
    init: () => ({ selection: null as string | null, draft: '' }),
    actions: {
      select: (d, target: string) => { d.selection = target },
      setDraft: (d, text: string) => { d.draft = text },
      clearDraft: (d) => { d.draft = '' },
    },
  })

  it('create() yields a live instance: fresh init state, selector-visible action writes', () => {
    const inst = declare().create()
    expect(inst.store.getSnapshot()).toEqual({ selection: null, draft: '' })
    inst.actions.setDraft('hello')
    inst.actions.select('m1')
    expect(inst.store.getSnapshot()).toEqual({ selection: 'm1', draft: 'hello' })
    inst.actions.clearDraft()
    expect(inst.store.getSnapshot().draft).toBe('')
  })

  it('bakes draft-stripped actions that write through update (draft mutation, not replacement)', () => {
    const inst = declare().create()
    const before = inst.store.getSnapshot()
    inst.actions.setDraft('x')
    const after = inst.store.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.selection).toBe(before.selection)   // untouched branch preserved (immer path)
  })

  it('creates independent instances per create() call (the handle is a spec, not a singleton)', () => {
    const handle = declare()
    const a = handle.create()
    const b = handle.create()
    a.actions.setDraft('only-a')
    expect(b.store.getSnapshot().draft).toBe('')
  })

  it('suffixes the persist key with the scope key: per-session persistence plus clearPersisted cleanup', async () => {
    vi.useFakeTimers()
    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v) },
      removeItem: (k: string) => { backing.delete(k) },
    })
    const handle = defineStore({
      init: () => ({ draft: '' }),
      persist: 'spec.chat',
      actions: { setDraft: (d, text: string) => { d.draft = text } },
    })
    handle.create('s1').actions.setDraft('one')
    handle.create('s2').actions.setDraft('two')
    handle.create().actions.setDraft('root')
    await vi.advanceTimersByTimeAsync(200)
    expect(JSON.parse(backing.get('spec.chat.s1')!)).toEqual({ draft: 'one' })
    expect(JSON.parse(backing.get('spec.chat.s2')!)).toEqual({ draft: 'two' })
    expect(JSON.parse(backing.get('spec.chat')!)).toEqual({ draft: 'root' })
    // Rehydration honors the same suffixed key.
    expect(handle.create('s1').store.getSnapshot().draft).toBe('one')
    // Scope-death cleanup removes exactly the suffixed key.
    handle.create('s1').clearPersisted()
    expect(backing.has('spec.chat.s1')).toBe(false)
    expect(backing.has('spec.chat.s2')).toBe(true)
    expect(backing.has('spec.chat')).toBe(true)
    vi.useRealTimers()
  })

  it('clearPersisted is a no-op without a persist declaration or without storage', () => {
    const inst = declare().create('s1')   // no persist key declared
    expect(() => { inst.clearPersisted() }).not.toThrow()
    const persisting = defineStore({
      init: () => ({ n: 0 }),
      persist: 'spec.nostorage',
      actions: { inc: (d) => { d.n += 1 } },
    }).create()
    // jsdom-less lane: localStorage may exist here, so simulate its absence.
    vi.stubGlobal('localStorage', undefined)
    expect(() => { persisting.clearPersisted() }).not.toThrow()
  })

  it('swallows storage failures in clearPersisted (same non-fatal contract as persistence)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => { throw new Error('quota / private mode') },
    })
    const inst = defineStore({
      init: () => ({ n: 0 }),
      persist: 'spec.throwing',
      actions: { inc: (d) => { d.n += 1 } },
    }).create()
    expect(() => { inst.clearPersisted() }).not.toThrow()
  })
})

describe('shallowEqual', () => {
  it('matches one-level-equal objects and rejects deeper drift', () => {
    const leaf = { deep: 1 }
    expect(shallowEqual({ x: 1, y: leaf }, { x: 1, y: leaf })).toBe(true)
    expect(shallowEqual({ x: 1, y: { deep: 1 } }, { x: 1, y: { deep: 1 } })).toBe(false)
    expect(shallowEqual([1, 2], [1, 2])).toBe(true)
    expect(shallowEqual([1, 2], [2, 1])).toBe(false)
  })
})
