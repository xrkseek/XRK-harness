// @vitest-environment jsdom
/**
 * The picker glyph must BE the engine silhouette, not a second hand-drawn set.
 * `scripts/gen-shape-glyphs.mjs` derives every path from rings.js — this spec
 * guards the contract: same ids, same order, real closed outlines, no copy-paste.
 */
import { describe, expect, it } from 'vitest'
import { SHAPE_GLYPHS } from '../src/client/shape-glyphs.ts'
import { COMPANION_SHAPES } from '../src/client/dressing-library.ts'

describe('shape glyphs', () => {
  it('covers exactly the companion shapes, in order', () => {
    expect(Object.keys(SHAPE_GLYPHS)).toEqual([...COMPANION_SHAPES])
    expect(Object.keys(SHAPE_GLYPHS)).toHaveLength(COMPANION_SHAPES.length)
  })

  it('every entry is a closed, non-empty path', () => {
    for (const id of COMPANION_SHAPES) {
      const d = SHAPE_GLYPHS[id]
      expect(typeof d, id).toBe('string')
      expect(d.length, id).toBeGreaterThan(20)
      expect(d.startsWith('M'), id).toBe(true)
      expect(d.trimEnd().endsWith('Z'), id).toBe(true)
      expect(d, id).toMatch(/^M[-\d.]+ [-\d.]+(?:L[-\d.]+ [-\d.]+)+Z$/)
    }
  })

  it('no two shapes share a path', () => {
    const seen = new Map<string, string>()
    for (const [id, d] of Object.entries(SHAPE_GLYPHS)) {
      const twin = seen.get(d)
      expect(twin, `${id} duplicates ${twin}`).toBeUndefined()
      seen.set(d, id)
    }
  })

  it('stays inside the 36×36 viewBox', () => {
    for (const [id, d] of Object.entries(SHAPE_GLYPHS)) {
      const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
      for (const n of nums) {
        expect(n, id).toBeGreaterThanOrEqual(0)
        expect(n, id).toBeLessThanOrEqual(36)
      }
    }
  })
})
