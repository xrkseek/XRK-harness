import { beforeEach, describe, expect, it } from 'vitest'
import {
  readOverviewLoadCache,
  resetOverviewLoadCacheForTests,
  writeOverviewLoadCache,
} from '../src/client/overview-load-cache.ts'
import type { PreviewTabLoad } from '../src/client/preview-load.ts'

function stubLoad(label: string): PreviewTabLoad {
  return {
    plan: null,
    office: null,
    // Cache only needs a non-null status identity for LRU tests.
    status: { badge: label } as NonNullable<PreviewTabLoad['status']>,
  }
}

describe('overview-load-cache', () => {
  beforeEach(() => {
    resetOverviewLoadCacheForTests()
  })

  it('remembers the last successful Status per Session', () => {
    writeOverviewLoadCache('a', stubLoad('a'))
    writeOverviewLoadCache('b', stubLoad('b'))
    expect(readOverviewLoadCache('a')?.status?.badge).toBe('a')
    expect(readOverviewLoadCache('b')?.status?.badge).toBe('b')
  })

  it('skips writes with null status so prior paint stays', () => {
    writeOverviewLoadCache('a', stubLoad('keep'))
    writeOverviewLoadCache('a', { plan: null, office: null, status: null })
    expect(readOverviewLoadCache('a')?.status?.badge).toBe('keep')
  })

  it('evicts oldest Sessions when over cap', () => {
    for (let i = 0; i < 30; i++) {
      writeOverviewLoadCache(`s${i}`, stubLoad(`s${i}`))
    }
    expect(readOverviewLoadCache('s0')).toBeUndefined()
    expect(readOverviewLoadCache('s29')?.status?.badge).toBe('s29')
  })
})
