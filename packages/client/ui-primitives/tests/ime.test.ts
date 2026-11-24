import { describe, expect, it } from 'vitest'
import { isComposingKeyboardEvent } from '../src/ime.ts'

describe('isComposingKeyboardEvent', () => {
  it('flags isComposing and keyCode 229', () => {
    expect(isComposingKeyboardEvent({ isComposing: true, keyCode: 13 })).toBe(true)
    expect(isComposingKeyboardEvent({ isComposing: false, keyCode: 229 })).toBe(true)
    expect(isComposingKeyboardEvent({ isComposing: false, keyCode: 13 })).toBe(false)
  })

  it('honours the Safari grace callback', () => {
    expect(isComposingKeyboardEvent(
      { isComposing: false, keyCode: 13 },
      () => true,
    )).toBe(true)
    expect(isComposingKeyboardEvent(
      { isComposing: false, keyCode: 13 },
      () => false,
    )).toBe(false)
  })
})
