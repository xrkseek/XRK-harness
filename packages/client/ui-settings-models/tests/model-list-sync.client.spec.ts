import { describe, expect, it } from 'vitest'
import type { DiscoveredModelView } from '@xrkseek/xrk-api-remotes/client'
import { adopt, candidateFacts, numberOf, syncListedModels, textOf } from '../src/client/model-list-sync.ts'

/** A listing row; every optional field is spelled per test so absence is explicit. */
function listed(entry: Record<string, unknown>): DiscoveredModelView {
  return entry as unknown as DiscoveredModelView
}

describe('textOf / numberOf', () => {
  it('reads only the declared type and spells absence as empty', () => {
    expect(textOf({ id: 'a' }, 'id')).toBe('a')
    expect(textOf({ id: 7 }, 'id')).toBe('')
    expect(textOf({}, 'id')).toBe('')
    expect(numberOf({ contextWindow: 1 }, 'contextWindow')).toBe(1)
    expect(numberOf({ contextWindow: '1' }, 'contextWindow')).toBeUndefined()
    expect(numberOf({}, 'contextWindow')).toBeUndefined()
  })
})

describe('syncListedModels', () => {
  it('keeps a row that is still listed, in place, with its hand-edited display name', () => {
    const rows = [
      { id: 'a', name: 'My Alpha' },
      { id: 'b', name: 'My Beta' },
    ]
    const merged = syncListedModels(rows, [listed({ id: 'b', name: 'upstream-b' }), listed({ id: 'a', name: 'upstream-a' })])
    expect(merged).toEqual(rows)
  })

  it('drops a row the listing no longer serves', () => {
    const merged = syncListedModels([{ id: 'gone' }, { id: 'kept' }], [listed({ id: 'kept' })])
    expect(merged).toEqual([{ id: 'kept' }])
  })

  it('keeps a row whose id is still being typed', () => {
    const blank = { name: 'fresh row' }
    expect(syncListedModels([blank], [listed({ id: 'x' })])).toEqual([blank])
  })

  it('fills a blank capacity but never overwrites one the user set', () => {
    const merged = syncListedModels(
      [{ id: 'a', contextWindow: 64000 }, { id: 'b' }],
      [listed({ id: 'a', contextWindow: 131072, maxTokens: 8192 }), listed({ id: 'b', contextWindow: 131072 })],
    )
    expect(merged).toEqual([
      { id: 'a', contextWindow: 64000, maxTokens: 8192 },
      { id: 'b', contextWindow: 131072 },
    ])
  })

  it('fills blank intake modes and leaves a hand-set pair alone', () => {
    const merged = syncListedModels(
      [{ id: 'a' }, { id: 'b', inputModalities: ['text'] }],
      [listed({ id: 'a', inputModalities: ['text', 'image'] }), listed({ id: 'b', inputModalities: ['text', 'audio'] })],
    )
    expect(merged).toEqual([
      { id: 'a', inputModalities: ['text', 'image'] },
      { id: 'b', inputModalities: ['text'] },
    ])
  })

  it('replaces the thinking menu with whatever the listing disclosed', () => {
    const menu = { efforts: [{ id: 'low' }] }
    const merged = syncListedModels([{ id: 'a', reasoning: { efforts: [{ id: 'stale' }] } }], [listed({ id: 'a', reasoning: menu })])
    expect(merged[0]?.['reasoning']).toBe(menu)
  })

  it('copies disclosed arrays instead of aliasing the listing', () => {
    const modalities = ['text', 'image']
    const merged = syncListedModels([{ id: 'a' }], [listed({ id: 'a', inputModalities: modalities })])
    expect(merged[0]?.['inputModalities']).toEqual(modalities)
    expect(merged[0]?.['inputModalities']).not.toBe(modalities)
  })
})

describe('adopt', () => {
  it('carries every disclosed field and omits the rest', () => {
    expect(adopt(listed({ id: 'a' }))).toEqual({ id: 'a' })
    expect(adopt(listed({ id: 'a', name: 'A', contextWindow: 1, inputModalities: ['text'] }))).toEqual({
      id: 'a',
      name: 'A',
      contextWindow: 1,
      inputModalities: ['text'],
    })
  })
})

describe('candidateFacts', () => {
  it('reports nothing when the listing disclosed nothing', () => {
    expect(candidateFacts(listed({ id: 'a' }))).toBeUndefined()
  })

  it('spells binary capacities the way the provider measured them', () => {
    expect(candidateFacts(listed({ id: 'a', contextWindow: 131072 }))).toBe('128K ctx')
    expect(candidateFacts(listed({ id: 'a', maxTokens: 8192 }))).toBe('8K out')
    expect(candidateFacts(listed({ id: 'a', contextWindow: 250000 }))).toBe('250K ctx')
  })

  it('joins capacities and the thinking menu with a separator', () => {
    const facts = candidateFacts(
      listed({
        id: 'a',
        contextWindow: 131072,
        maxTokens: 8192,
        reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] },
      }),
    )
    expect(facts).toBe('128K ctx · 8K out · low/high')
  })
})
