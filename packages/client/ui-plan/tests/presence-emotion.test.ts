import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PRESENCE_COLOR,
  PRESENCE_COLOR_PALETTES,
  PRESENCE_KITS,
  PRESENCE_SHAPES,
  resolvePresencePaint,
} from '../src/presence-settings.ts'
import {
  PRESENCE_TOOL_TTL_MS,
  derivePresenceEmotion,
  playPresenceAccent,
  sessionBallPersona,
} from '../src/client/PresenceBall.tsx'

describe('derivePresenceEmotion', () => {
  it('prefers fresh sticky tool presence', () => {
    expect(derivePresenceEmotion({
      presence: { emotionId: '10', tips: 'yay', source: 'tool', updatedAt: 1_000 },
      turnActive: true,
      runningJobs: 2,
      runningSubs: 1,
      fleetHealth: 'critical',
      nowMs: 1_000 + 1_000,
    })).toEqual({
      emotionId: '10',
      tips: 'yay',
      source: 'tool',
    })
  })

  it('expires sticky tool presence after TTL', () => {
    expect(derivePresenceEmotion({
      presence: { emotionId: '10', tips: 'yay', source: 'tool', updatedAt: 1_000 },
      turnActive: false,
      runningJobs: 0,
      runningSubs: 0,
      fleetHealth: 'ok',
      nowMs: 1_000 + PRESENCE_TOOL_TTL_MS + 1,
      phase: 0,
    })).toMatchObject({ emotionId: '02', tipKey: 'ambient', source: 'auto' })
  })

  it('ignores sleep sticky while the session is busy', () => {
    expect(derivePresenceEmotion({
      presence: { emotionId: '00', tips: 'napping', source: 'tool', updatedAt: 5_000 },
      turnActive: true,
      runningJobs: 0,
      runningSubs: 0,
      fleetHealth: 'ok',
      nowMs: 5_000,
      phase: 0,
    })).toMatchObject({ emotionId: '30', tipKey: 'turn', source: 'auto' })
  })

  it('lets local click pulse win over tool and activity', () => {
    expect(derivePresenceEmotion({
      presence: { emotionId: '32', tips: 'busy', source: 'tool', updatedAt: 5_000 },
      turnActive: true,
      runningJobs: 0,
      runningSubs: 0,
      fleetHealth: 'ok',
      nowMs: 5_000,
      local: { emotionId: '10' },
    })).toMatchObject({ emotionId: '10', tipKey: 'local', source: 'local' })
  })

  it('maps activity to auto tip keys and rotates work moods', () => {
    expect(derivePresenceEmotion({
      turnActive: false,
      runningJobs: 0,
      runningSubs: 0,
      fleetHealth: 'ok',
      phase: 0,
    }).emotionId).toBe('02')

    expect(derivePresenceEmotion({
      turnActive: true,
      runningJobs: 0,
      runningSubs: 0,
      fleetHealth: 'ok',
      phase: 0,
    })).toMatchObject({ emotionId: '30', tipKey: 'turn', source: 'auto' })

    expect(derivePresenceEmotion({
      turnActive: true,
      runningJobs: 0,
      runningSubs: 0,
      fleetHealth: 'ok',
      phase: 1,
    })).toMatchObject({ emotionId: '32', tipKey: 'turn', source: 'auto' })

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

  it('listens when queue/steer is waiting without an active turn', () => {
    expect(derivePresenceEmotion({
      turnActive: false,
      runningJobs: 0,
      runningSubs: 0,
      fleetHealth: 'ok',
      queued: 1,
    })).toMatchObject({ emotionId: '35', tipKey: 'listen', source: 'auto' })

    expect(derivePresenceEmotion({
      turnActive: false,
      runningJobs: 0,
      runningSubs: 0,
      fleetHealth: 'ok',
      steering: 2,
    })).toMatchObject({ emotionId: '35', tipKey: 'listen' })

    // Active turn still wins over inbox.
    expect(derivePresenceEmotion({
      turnActive: true,
      runningJobs: 0,
      runningSubs: 0,
      fleetHealth: 'ok',
      queued: 3,
      phase: 0,
    })).toMatchObject({ tipKey: 'turn' })
  })

  it('shows compact mood when compaction is busy and nothing else is', () => {
    expect(derivePresenceEmotion({
      turnActive: false,
      runningJobs: 0,
      runningSubs: 0,
      fleetHealth: 'ok',
      compactionBusy: true,
    })).toMatchObject({ emotionId: '36', tipKey: 'compact', source: 'auto' })
  })

  it('surfaces recent tool errors above ambient / idle', () => {
    expect(derivePresenceEmotion({
      turnActive: false,
      runningJobs: 0,
      runningSubs: 0,
      fleetHealth: 'ok',
      toolError: { name: 'bash' },
      idleMs: 200_000,
    })).toMatchObject({ emotionId: '34', tipKey: 'toolError', source: 'auto', tips: 'bash' })
  })

  it('enters standby then sleep on long quiet idle', () => {
    expect(derivePresenceEmotion({
      turnActive: false,
      runningJobs: 0,
      runningSubs: 0,
      fleetHealth: 'ok',
      idleMs: 45_000,
    })).toMatchObject({ emotionId: '06', tipKey: 'standby', source: 'auto' })

    expect(derivePresenceEmotion({
      turnActive: false,
      runningJobs: 0,
      runningSubs: 0,
      fleetHealth: 'ok',
      idleMs: 120_000,
    })).toMatchObject({ emotionId: '00', tipKey: 'sleep', source: 'auto' })
  })
})

describe('sessionBallPersona', () => {
  it('is stable for a session id and differs across sessions (seed only; shape/color are Settings)', () => {
    const a = sessionBallPersona('session-alpha')
    const b = sessionBallPersona('session-beta')
    expect(sessionBallPersona('session-alpha')).toEqual(a)
    expect(a.seed).not.toEqual(b.seed)
    expect(a.seed).toBeGreaterThanOrEqual(0)
    expect(a.seed).toBeLessThan(100)
  })
})

describe('PRESENCE_SHAPES', () => {
  it('includes extra silhouettes beyond blob/wedge/gem', () => {
    expect(PRESENCE_SHAPES).toEqual([
      'blob',
      'wedge',
      'gem',
      'squircle',
      'drop',
      'pill',
      'petal',
      'loaf',
      'heart',
      'star',
      'hex',
      'egg',
      'cloud',
      'shield',
    ])
  })
})

describe('PRESENCE_KITS', () => {
  it('covers hats and several glasses styles', () => {
    expect(PRESENCE_KITS).toEqual([
      'none',
      'bow',
      'cap',
      'beanie',
      'visor',
      'specs',
      'specs-rect',
      'specs-cat',
      'specs-sun',
      'halo',
    ])
  })
})

describe('resolvePresencePaint', () => {
  it('defaults cream to warm body + dark eyes (not pure white)', () => {
    const paint = resolvePresencePaint(DEFAULT_PRESENCE_COLOR, false)
    expect(paint.body.toUpperCase()).toBe('#F3F0EA')
    expect(paint.eyes.toUpperCase()).toBe('#1A1A1A')
    expect(paint.body.toUpperCase()).not.toBe('#FFFFFF')
  })

  it('picks the dark-mode companion tint', () => {
    const light = resolvePresencePaint('mist', false)
    const dark = resolvePresencePaint('mist', true)
    expect(light).toEqual(PRESENCE_COLOR_PALETTES.mist.light)
    expect(dark).toEqual(PRESENCE_COLOR_PALETTES.mist.dark)
    expect(dark.body).not.toEqual(light.body)
  })

  it('uses light eyes on slate dark so pupils stay visible', () => {
    const paint = resolvePresencePaint('slate', true)
    expect(paint.eyes.toUpperCase()).toBe('#F0EEE8')
  })

  it('keeps extra palettes including cocoa dark eyes', () => {
    expect(resolvePresencePaint('coral', false).body.toUpperCase()).toBe('#F0C8BC')
    expect(resolvePresencePaint('cocoa', true).eyes.toUpperCase()).toBe('#F0EEE8')
    expect(resolvePresencePaint('honey', false).body.toUpperCase()).toBe('#E8C46A')
    expect(resolvePresencePaint('ink', false).eyes.toUpperCase()).toBe('#F0EEE8')
  })
})

describe('playPresenceAccent', () => {
  function fakeBall() {
    return {
      setEmotion: vi.fn(),
      setGaze: vi.fn(),
      handleAIMessage: vi.fn(),
      setActive: vi.fn(),
      destroy: vi.fn(),
      bounce: vi.fn(),
      spin: vi.fn(),
      burst: vi.fn(),
    }
  }

  it('bounces on session tipKey edges, not quiet phase rotation', () => {
    const ball = fakeBall()
    playPresenceAccent(
      ball,
      { emotionId: '30', tipKey: 'turn', source: 'auto' },
      { emotionId: '02', tipKey: 'ambient', source: 'auto' },
    )
    expect(ball.bounce).toHaveBeenCalledOnce()

    ball.bounce.mockClear()
    playPresenceAccent(
      ball,
      { emotionId: '32', tipKey: 'turn', source: 'auto' },
      { emotionId: '30', tipKey: 'turn', source: 'auto' },
    )
    expect(ball.bounce).not.toHaveBeenCalled()
  })

  it('celebrates when work settles back to ambient', () => {
    const ball = fakeBall()
    playPresenceAccent(
      ball,
      { emotionId: '02', tipKey: 'ambient', source: 'auto' },
      { emotionId: '30', tipKey: 'turn', source: 'auto' },
    )
    expect(ball.burst).toHaveBeenCalled()
    expect(ball.bounce).toHaveBeenCalled()
  })

  it('bursts on celebrate sticky ids', () => {
    const ball = fakeBall()
    playPresenceAccent(
      ball,
      { emotionId: '33', source: 'tool' },
      null,
    )
    expect(ball.burst).toHaveBeenCalled()
    expect(ball.bounce).toHaveBeenCalled()
  })
})
