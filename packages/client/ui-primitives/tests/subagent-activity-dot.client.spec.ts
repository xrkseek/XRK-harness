import { describe, expect, it } from 'vitest'
import { subagentActivityDot } from '../src/subagent-activity-dot.ts'

describe('subagentActivityDot', () => {
  it('running always paints ongoing', () => {
    expect(subagentActivityDot('running')).toBe('ongoing')
    expect(subagentActivityDot('running', 'aborted')).toBe('ongoing')
    expect(subagentActivityDot('running', 'completed')).toBe('ongoing')
  })

  it('abnormal terminals paint error when idle', () => {
    for (const kind of ['aborted', 'error', 'interrupted', 'max-tokens', 'blocked'] as const) {
      expect(subagentActivityDot('inactive', kind)).toBe('error')
    }
  })

  it('completed / none / missing outcome paint done when idle', () => {
    expect(subagentActivityDot('inactive', 'completed')).toBe('done')
    expect(subagentActivityDot('inactive', 'none')).toBe('done')
    expect(subagentActivityDot('inactive')).toBe('done')
    expect(subagentActivityDot(undefined)).toBe('done')
  })
})
