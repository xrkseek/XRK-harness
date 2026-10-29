import { describe, expect, it } from 'vitest'
import { computeKeyboardInsetPx } from '../src/client/visual-viewport-keyboard.ts'

describe('computeKeyboardInsetPx', () => {
  it('returns 0 when the visual viewport fills the layout height', () => {
    expect(computeKeyboardInsetPx(800, 800, 0)).toBe(0)
  })

  it('returns the covered band for an overlay keyboard', () => {
    expect(computeKeyboardInsetPx(800, 480, 0)).toBe(320)
  })

  it('subtracts visualViewport.offsetTop (iOS URL chrome / scrolled VV)', () => {
    expect(computeKeyboardInsetPx(800, 480, 40)).toBe(280)
  })

  it('clamps negative / non-finite to 0', () => {
    expect(computeKeyboardInsetPx(800, 900, 0)).toBe(0)
    expect(computeKeyboardInsetPx(Number.NaN, 480, 0)).toBe(0)
  })
})
