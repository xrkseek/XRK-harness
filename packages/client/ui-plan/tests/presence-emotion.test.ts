import { describe, expect, it } from 'vitest'
import { derivePresenceEmotion } from '../src/client/PresenceBall.tsx'

describe('derivePresenceEmotion', () => {
  it('prefers sticky tool presence', () => {
    expect(derivePresenceEmotion({
      presence: { emotionId: '10', tips: 'yay', source: 'tool' },
      turnActive: true,
      runningJobs: 2,
      runningSubs: 1,
      fleetHealth: 'critical',
    })).toEqual({
      emotionId: '10',
      tips: 'yay',
      source: 'tool',
    })
  })

  it('maps activity to auto tip keys', () => {
    expect(derivePresenceEmotion({
      turnActive: false,
      runningJobs: 0,
      runningSubs: 0,
      fleetHealth: 'ok',
    }).emotionId).toBe('02')

    expect(derivePresenceEmotion({
      turnActive: true,
      runningJobs: 0,
      runningSubs: 0,
      fleetHealth: 'ok',
    })).toMatchObject({ emotionId: '30', tipKey: 'turn', source: 'auto' })

    expect(derivePresenceEmotion({
      turnActive: false,
      runningJobs: 1,
      runningSubs: 0,
      fleetHealth: 'ok',
    })).toMatchObject({ emotionId: '40', tipKey: 'jobs' })

    expect(derivePresenceEmotion({
      turnActive: false,
      runningJobs: 0,
      runningSubs: 1,
      fleetHealth: 'ok',
    })).toMatchObject({ emotionId: '03', tipKey: 'subs' })

    expect(derivePresenceEmotion({
      turnActive: false,
      runningJobs: 0,
      runningSubs: 0,
      fleetHealth: 'warn',
    })).toMatchObject({ emotionId: '13', tipKey: 'warn' })

    expect(derivePresenceEmotion({
      turnActive: false,
      runningJobs: 0,
      runningSubs: 0,
      fleetHealth: 'critical',
    })).toMatchObject({ emotionId: '34', tipKey: 'critical' })
  })
})
