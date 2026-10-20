// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  COMMAND_FRECENCY_STORAGE_KEY,
  clearCommandFrecencyCacheForTests,
  frecencyScore,
  loadCommandFrecency,
  recordCommandUse,
  saveCommandFrecency,
} from '../src/client/command-frecency.ts'

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    get length() { return map.size },
    clear() { map.clear() },
    getItem(key: string) { return map.has(key) ? map.get(key)! : null },
    key(index: number) { return [...map.keys()][index] ?? null },
    removeItem(key: string) { map.delete(key) },
    setItem(key: string, value: string) { map.set(key, String(value)) },
  }
}

beforeEach(() => {
  clearCommandFrecencyCacheForTests()
})

describe('command-frecency', () => {
  it('records uses and ranks recent+frequent higher', () => {
    const storage = memoryStorage()
    const t0 = 1_000_000
    recordCommandUse('theme', t0, storage)
    recordCommandUse('theme', t0 + 1, storage)
    recordCommandUse('status', t0 + 2, storage)
    const doc = loadCommandFrecency(storage)
    expect(frecencyScore('theme', doc, t0 + 2)).toBeGreaterThan(frecencyScore('status', doc, t0 + 2))
    expect(frecencyScore('missing', doc, t0)).toBe(0)
  })

  it('keeps unused at zero so declaration order stays stable', () => {
    const doc = {}
    expect(frecencyScore('a', doc)).toBe(0)
    expect(frecencyScore('b', doc)).toBe(0)
  })

  it('tolerates corrupt storage', () => {
    const storage = memoryStorage({ [COMMAND_FRECENCY_STORAGE_KEY]: '{not-json' })
    expect(loadCommandFrecency(storage)).toEqual({})
  })

  it('drops empty documents', () => {
    const storage = memoryStorage()
    saveCommandFrecency({}, storage)
    expect(storage.getItem(COMMAND_FRECENCY_STORAGE_KEY)).toBeNull()
  })
})
