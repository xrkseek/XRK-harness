import { describe, expect, it } from 'vitest'
import { shouldOsNotify } from '../src/client/sessions/os-notify.ts'

describe('shouldOsNotify', () => {
  it('skips when focused under unfocused policy', () => {
    expect(
      shouldOsNotify({ focusPolicy: 'unfocused', isFocused: () => true }),
    ).toBe(false)
  })

  it('fires when unfocused', () => {
    expect(
      shouldOsNotify({ focusPolicy: 'unfocused', isFocused: () => false }),
    ).toBe(true)
  })

  it('always fires under always policy', () => {
    expect(
      shouldOsNotify({ focusPolicy: 'always', isFocused: () => true }),
    ).toBe(true)
  })
})
