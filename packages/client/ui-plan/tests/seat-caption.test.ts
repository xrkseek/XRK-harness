import { describe, expect, it } from 'vitest'
import { childDelegateSeatCaption, delegateSeatCaption } from '../src/client/seat-caption.ts'

describe('delegateSeatCaption', () => {
  it('returns role alone when nickname is empty', () => {
    expect(delegateSeatCaption('老板', undefined)).toBe('老板')
    expect(delegateSeatCaption('老板', '  ')).toBe('老板')
  })

  it('formats Boss nickname like 老板 · 阿凯', () => {
    expect(delegateSeatCaption('老板', '阿凯')).toBe('老板 · 阿凯')
  })

  it('keeps an already composed Face label', () => {
    expect(delegateSeatCaption('经理', '经理 · 老王')).toBe('经理 · 老王')
    expect(delegateSeatCaption('经理', '经理（老王）')).toBe('经理（老王）')
  })
})

describe('childDelegateSeatCaption', () => {
  const titles = { manager: '经理', agent: '干员' }

  it('prefixes 干员 for agent-home / tool children', () => {
    expect(childDelegateSeatCaption(titles, 'agent', '文献检索员')).toBe('干员 · 文献检索员')
  })

  it('prefixes 经理 for project home', () => {
    expect(childDelegateSeatCaption(titles, 'manager', '老王')).toBe('经理 · 老王')
  })

  it('shows 向日葵 name only', () => {
    expect(childDelegateSeatCaption(titles, 'sunflower', '向日葵')).toBe('向日葵')
  })

  it('defaults missing childSeat to 干员 (identity, not 经理)', () => {
    expect(childDelegateSeatCaption(titles, undefined, '文献检索员')).toBe('干员 · 文献检索员')
  })
})
