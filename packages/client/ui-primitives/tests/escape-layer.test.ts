import { describe, expect, it } from 'vitest'
import {
  isTopEscapeLayer,
  popEscapeLayer,
  pushEscapeLayer,
} from '../src/escape-layer.ts'

describe('escape-layer', () => {
  it('gives Escape ownership to the last push', () => {
    const outer = pushEscapeLayer()
    const inner = pushEscapeLayer()
    expect(isTopEscapeLayer(outer)).toBe(false)
    expect(isTopEscapeLayer(inner)).toBe(true)
    popEscapeLayer(inner)
    expect(isTopEscapeLayer(outer)).toBe(true)
    popEscapeLayer(outer)
    expect(isTopEscapeLayer(outer)).toBe(false)
  })

  it('pop is idempotent and order-safe', () => {
    const a = pushEscapeLayer()
    const b = pushEscapeLayer()
    popEscapeLayer(a)
    expect(isTopEscapeLayer(b)).toBe(true)
    popEscapeLayer(a)
    popEscapeLayer(b)
    expect(isTopEscapeLayer(b)).toBe(false)
  })
})
