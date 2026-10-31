import { describe, expect, it } from 'vitest'
import {
  childDelegateSeatCaption,
  delegateSeatCaption,
  memberDisplayLabel,
  parentDelegateSeatCaption,
  withLiveNickname,
} from '../src/client/seat-caption.ts'

describe('delegateSeatCaption', () => {
  it('returns role alone when nickname is empty', () => {
    expect(delegateSeatCaption('老板', undefined)).toBe('老板')
    expect(delegateSeatCaption('老板', '  ')).toBe('老板')
  })

  it('joins role and formal with a middle dot', () => {
    expect(delegateSeatCaption('干员', '创业作业')).toBe('干员 · 创业作业')
  })

  it('keeps formal（nick） after the role', () => {
    expect(delegateSeatCaption('干员', '创业作业（成经吴）')).toBe(
      '干员 · 创业作业（成经吴）',
    )
  })

  it('keeps an already composed Face label', () => {
    expect(delegateSeatCaption('经理', '经理 · 老王')).toBe('经理 · 老王')
    expect(delegateSeatCaption('经理', '经理（老王）')).toBe('经理（老王）')
  })
})

describe('memberDisplayLabel', () => {
  it('keeps formal and appends nick in parentheses', () => {
    expect(memberDisplayLabel('创业作业', '成经吴')).toBe('创业作业（成经吴）')
    expect(memberDisplayLabel('创业作业', null)).toBe('创业作业')
    expect(memberDisplayLabel('创业作业', undefined)).toBe('创业作业')
  })
})

describe('parentDelegateSeatCaption', () => {
  it('office home uses boss title + nickname', () => {
    expect(
      parentDelegateSeatCaption('老板', {
        officeBossSeat: true,
        bossNickname: '成总',
        parentLabel: '经理',
        managerTitle: '经理',
      }),
    ).toBe('老板（成总）')
  })

  it('tool child uses Face parentLabel as-is (no 老板 · 经理)', () => {
    expect(
      parentDelegateSeatCaption('老板', {
        officeBossSeat: false,
        bossNickname: '成总',
        parentLabel: '经理（阿经）',
        managerTitle: '经理',
      }),
    ).toBe('经理（阿经）')
    expect(
      parentDelegateSeatCaption('主公', {
        officeBossSeat: false,
        parentLabel: '军师',
        managerTitle: '军师',
      }),
    ).toBe('军师')
  })

  it('falls back to manager title while parentLabel pending', () => {
    expect(
      parentDelegateSeatCaption('老板', {
        officeBossSeat: false,
        managerTitle: '经理',
      }),
    ).toBe('经理')
  })
})

describe('childDelegateSeatCaption', () => {
  const titles = { manager: '经理', agent: '干员' }

  it('shows 干员 · formal（nick）', () => {
    expect(childDelegateSeatCaption(titles, 'agent', '创业作业（成经吴）')).toBe(
      '干员 · 创业作业（成经吴）',
    )
    expect(childDelegateSeatCaption(titles, 'agent', '创业作业')).toBe(
      '干员 · 创业作业',
    )
  })

  it('keeps 经理（老王） when Face already composed', () => {
    expect(childDelegateSeatCaption(titles, 'manager', '经理（老王）')).toBe(
      '经理（老王）',
    )
  })

  it('paints sunflower as 经理席对位', () => {
    expect(childDelegateSeatCaption(titles, 'sunflower', '向日葵（xrkseek）')).toBe(
      '经理 · 向日葵（xrkseek）',
    )
    expect(childDelegateSeatCaption(titles, 'manager', '向日葵（xrkseek）')).toBe(
      '经理 · 向日葵（xrkseek）',
    )
  })

  it('defaults missing childSeat to 干员 (identity, not 经理)', () => {
    expect(childDelegateSeatCaption(titles, undefined, '创业作业（成经吴）')).toBe(
      '干员 · 创业作业（成经吴）',
    )
  })
})

describe('withLiveNickname', () => {
  it('keeps Face label when no live patch', () => {
    expect(withLiveNickname('经理', '经理（阿经）', undefined)).toBe('经理（阿经）')
  })

  it('overlays optimistic nick with formal kept', () => {
    expect(withLiveNickname('经理', '经理', '老王')).toBe('经理（老王）')
    expect(withLiveNickname('干员', '创业作业', '成经吴', '创业作业')).toBe(
      '干员 · 创业作业（成经吴）',
    )
    expect(withLiveNickname('经理', '经理 · 老王', null)).toBe('经理')
  })
})
