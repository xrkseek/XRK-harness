import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearTeamRosterLive,
  normalizeTeamRosterLiveLook,
  patchTeamRosterLive,
  readTeamRosterLive,
} from '../src/client/team-roster-live.ts'

describe('team-roster-live', () => {
  beforeEach(() => {
    clearTeamRosterLive()
  })

  it('replaces appearance wholesale so cleared overlays do not stick', () => {
    patchTeamRosterLive('mem_a', {
      appearance: {
        shape: 'blob',
        color: 'cream',
        kitHat: 'sticker:stk_oldhat1',
        overlayHat: 'data:image/png;base64,old',
      },
    })
    patchTeamRosterLive('mem_a', {
      appearance: {
        shape: 'teardrop',
        color: 'rose',
        kitHat: 'bow',
        overlayHat: '',
      },
    })
    expect(readTeamRosterLive('mem_a')?.appearance).toEqual({
      shape: 'teardrop',
      color: 'rose',
      kitHat: 'bow',
      overlayHat: '',
    })
  })

  it('keeps nickname when a look-only patch arrives', () => {
    patchTeamRosterLive('mem_b', { nickname: '小茶' })
    patchTeamRosterLive('mem_b', {
      appearance: { shape: 'petal', color: 'sky', kitHeld: 'tea' },
    })
    expect(readTeamRosterLive('mem_b')).toEqual({
      nickname: '小茶',
      appearance: { shape: 'petal', color: 'sky', kitHeld: 'tea' },
    })
  })

  it('normalizeTeamRosterLiveLook stamps Host-omitted clears', () => {
    expect(normalizeTeamRosterLiveLook({
      shape: 'teardrop',
      color: 'rose',
      kitHat: 'bow',
    })).toEqual({
      shape: 'teardrop',
      color: 'rose',
      bodyColor: '',
      eyeColor: '',
      kit: 'none',
      kitHat: 'bow',
      kitGlasses: 'none',
      kitHeld: 'none',
      overlayHat: '',
      overlayGlasses: '',
      overlayHeld: '',
    })
  })
})
