import { beforeEach, describe, expect, it } from 'vitest'
import {
  readPresenceLookCache,
  rememberCompanionLook,
  resetPresenceLookCacheForTests,
  resolveCompanionLook,
  warmCompanionLookFromPaint,
  writePresenceLookCache,
} from '../src/client/presence-look-cache.ts'
import {
  resetOverviewLoadCacheForTests,
  writeOverviewLoadCache,
} from '../src/client/overview-load-cache.ts'
import type { PreviewTabLoad } from '../src/client/preview-load.ts'

describe('presence-look-cache', () => {
  beforeEach(() => {
    resetPresenceLookCacheForTests()
    resetOverviewLoadCacheForTests()
  })

  it('remembers the last companionBall per Session (any costume)', () => {
    writePresenceLookCache('a', {
      shape: 'flower5',
      color: 'gold',
      kitHat: 'cap',
      overlayHeld: 'https://example/sticker.png',
    })
    writePresenceLookCache('b', { shape: 'petal', color: 'sky' })
    expect(readPresenceLookCache('a')).toEqual({
      shape: 'flower5',
      color: 'gold',
      kitHat: 'cap',
      overlayHeld: 'https://example/sticker.png',
    })
    expect(readPresenceLookCache('b')).toEqual({ shape: 'petal', color: 'sky' })
  })

  it('skips empty shape/color so prior paint stays', () => {
    writePresenceLookCache('a', { shape: 'flower5', color: 'gold' })
    writePresenceLookCache('a', { shape: '', color: 'gold' })
    rememberCompanionLook('a', null)
    rememberCompanionLook('a', { shape: 'blob', color: '' })
    expect(readPresenceLookCache('a')).toEqual({ shape: 'flower5', color: 'gold' })
  })

  it('resolveCompanionLook prefers Face look over cache', () => {
    writePresenceLookCache('a', { shape: 'blob', color: 'cream' })
    expect(resolveCompanionLook('a', { shape: 'gem', color: 'mint' })).toEqual({
      shape: 'gem',
      color: 'mint',
    })
    expect(resolveCompanionLook('a', undefined)).toEqual({ shape: 'blob', color: 'cream' })
    expect(resolveCompanionLook('missing', undefined)).toBeUndefined()
  })

  it('resolveCompanionLookWithLive falls through to live-only full looks', async () => {
    const { resolveCompanionLookWithLive } = await import('../src/client/presence-look-cache.ts')
    expect(resolveCompanionLookWithLive('z', undefined, {
      shape: 'flower5',
      color: 'gold',
      kitHat: 'cap',
    })).toEqual({
      shape: 'flower5',
      color: 'gold',
      kitHat: 'cap',
    })
    writePresenceLookCache('z', { shape: 'blob', color: 'cream' })
    expect(resolveCompanionLookWithLive('z', undefined, {
      shape: 'flower5',
      color: 'gold',
    })).toEqual({ shape: 'blob', color: 'cream' })
  })

  it('warmCompanionLookFromPaint merges Team hot-edit onto Face/cache', () => {
    warmCompanionLookFromPaint(
      'a',
      { shape: 'squircle', color: 'rose', kitHat: 'none' },
      { shape: 'flower5', color: 'gold', kitHat: 'cap' },
    )
    expect(readPresenceLookCache('a')).toEqual({
      shape: 'flower5',
      color: 'gold',
      kitHat: 'cap',
    })
  })

  it('warmCompanionLookFromPaint can seed from live-only shape+color', () => {
    warmCompanionLookFromPaint('b', undefined, {
      shape: 'petal',
      color: 'sky',
      kitHeld: 'wand',
    })
    expect(readPresenceLookCache('b')).toEqual({
      shape: 'petal',
      color: 'sky',
      kitHeld: 'wand',
    })
  })

  it('warmCompanionLookFromPaint never writes PENDING (no face, no live look)', () => {
    warmCompanionLookFromPaint('c', undefined, undefined)
    warmCompanionLookFromPaint('c', undefined, { kitHat: 'cap' })
    expect(readPresenceLookCache('c')).toBeUndefined()
  })

  it('overview Status write warms the look cache', () => {
    const load = {
      plan: null,
      office: null,
      status: {
        companionBall: { shape: 'squircle', color: 'rose', kit: 'glasses' },
      },
    } as PreviewTabLoad
    writeOverviewLoadCache('s1', load)
    expect(readPresenceLookCache('s1')).toEqual({
      shape: 'squircle',
      color: 'rose',
      kit: 'glasses',
    })
  })

  it('evicts oldest Sessions when over cap', () => {
    for (let i = 0; i < 60; i++) {
      writePresenceLookCache(`s${i}`, { shape: 'blob', color: 'cream' })
    }
    expect(readPresenceLookCache('s0')).toBeUndefined()
    expect(readPresenceLookCache('s59')).toEqual({ shape: 'blob', color: 'cream' })
  })
})
