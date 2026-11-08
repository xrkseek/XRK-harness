import { describe, expect, it } from 'vitest'
import { resolvePresenceStageSize } from '../src/client/presence-stage-size.ts'

describe('resolvePresenceStageSize', () => {
  it('compact glyphs stay 1× regardless of looks', () => {
    expect(resolvePresenceStageSize({
      compact: true,
      memberLook: undefined,
      bossSize: 1.2,
    })).toBe(1)
    expect(resolvePresenceStageSize({
      compact: true,
      memberLook: { size: 0.8 },
      bossSize: 1.2,
    })).toBe(1)
  })

  it('boss seat (no memberLook) uses Settings ui-presence.size', () => {
    expect(resolvePresenceStageSize({
      compact: false,
      memberLook: undefined,
      bossSize: 1.16,
    })).toBe(1.16)
  })

  it('member seat with omitted size stays 1 — does not follow boss', () => {
    expect(resolvePresenceStageSize({
      compact: false,
      memberLook: {},
      bossSize: 1.2,
    })).toBe(1)
  })

  it('member seat with explicit size keeps its own trim', () => {
    expect(resolvePresenceStageSize({
      compact: false,
      memberLook: { size: 0.86 },
      bossSize: 1.2,
    })).toBe(0.86)
  })
})
