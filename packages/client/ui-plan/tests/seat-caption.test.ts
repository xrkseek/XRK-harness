import { describe, expect, it } from 'vitest'
import { delegateSeatCaption } from '../src/client/seat-caption.ts'

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
