import { describe, expect, it } from 'vitest'
import { resolveSubmitMode } from '../src/client/input/resolve-submit-mode.ts'

describe('resolveSubmitMode (gate)', () => {
  it('shares Enter and Send (enter gesture) against the busy preference', () => {
    expect(resolveSubmitMode('queue', true, 'enter', true)).toBe('queue')
    expect(resolveSubmitMode('queue', true, 'accelerated', true)).toBe('steer')
    expect(resolveSubmitMode('steer', true, 'enter', true)).toBe('steer')
    expect(resolveSubmitMode('steer', true, 'accelerated', true)).toBe('queue')
    expect(resolveSubmitMode('steer', false, 'enter', true)).toBe('queue')
    expect(resolveSubmitMode('steer', true, 'enter', false)).toBe('queue')
  })
})
