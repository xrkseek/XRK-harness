// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { SettingsScope } from '@xrkseek/client-runtime/client'
import {
  bindDressingHost,
  setBossLookField,
  useBossLook,
  useDressingStickers,
} from '../src/client/dressing-scope.ts'
import {
  HELD_BUILTINS,
  parseStickers,
  resolveSlotOverlayImage,
  stickersForSlot,
} from '../src/client/dressing-library.ts'

function bind(value: { stickers?: string; shape?: string; color?: string } = {}) {
  const scope: SettingsScope<{ stickers?: string; shape?: string; color?: string }> = {
    getSnapshot: () => ({
      status: 'ready',
      value,
      base: undefined,
      user: undefined,
      revision: 0,
      writable: true,
      mode: 'host',
    }),
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
    patch: async () => {},
  }
  bindDressingHost(scope)
}

function StickersProbe({ seen }: { seen: unknown[] }) {
  seen.push(useDressingStickers())
  return null
}

function BossLookProbe({ seen }: { seen: unknown[] }) {
  seen.push(useBossLook())
  return null
}

describe('useDressingStickers', () => {
  it('returns a stable snapshot while the stickers string is unchanged', () => {
    bind({ stickers: '[]' })
    const seen: unknown[] = []
    const view = render(<StickersProbe seen={seen} />)
    view.rerender(<StickersProbe seen={seen} />)
    expect(seen.length).toBe(2)
    expect(seen[0]).toBe(seen[1])
  })
})

describe('useBossLook', () => {
  it('returns a stable snapshot while Host look fields are unchanged', () => {
    bind({ shape: 'blob', color: 'cream' })
    const seen: unknown[] = []
    const view = render(<BossLookProbe seen={seen} />)
    view.rerender(<BossLookProbe seen={seen} />)
    expect(seen.length).toBe(2)
    expect(seen[0]).toBe(seen[1])
  })
})

describe('parseStickers', () => {
  it('keeps an unscoped import on hat so it does not appear in every slot', () => {
    const rows = parseStickers(JSON.stringify([
      { id: 'stk_hatslot01', image: 'data:image/png;base64,AAAA', slot: 'hat' },
      { id: 'stk_legacy001', image: 'data:image/png;base64,AAAA' },
    ]))
    expect(stickersForSlot(rows, 'hat').map((row) => row.id)).toEqual(['stk_hatslot01', 'stk_legacy001'])
    expect(stickersForSlot(rows, 'glasses')).toEqual([])
    expect(stickersForSlot(rows, 'held')).toEqual([])
  })
})

describe('resolveSlotOverlayImage', () => {
  it('drops a leftover raw overlay when a builtin held is active', () => {
    expect(resolveSlotOverlayImage('flower', [], HELD_BUILTINS, 'data:image/png;base64,toilet'))
      .toBe('')
    expect(resolveSlotOverlayImage('none', [], HELD_BUILTINS, 'data:image/png;base64,toilet'))
      .toBe('data:image/png;base64,toilet')
  })
})

describe('setBossLookField kit slots', () => {
  it('clears overlayHeld when switching to a builtin held', () => {
    const patches: Array<{ op: string; path: string[]; value: unknown }> = []
    const scope: SettingsScope<Record<string, unknown>> = {
      getSnapshot: () => ({
        status: 'ready',
        value: {
          stickers: '[]',
          kitHeld: 'sticker:stk_toilet1',
          overlayHeld: 'data:image/png;base64,toilet',
        },
        base: undefined,
        user: undefined,
        revision: 0,
        writable: true,
        mode: 'host',
      }),
      subscribe: () => () => {},
      set: async () => {},
      unset: async () => {},
      patch: async (ops) => {
        for (const op of ops) patches.push(op as typeof patches[number])
      },
    }
    bindDressingHost(scope as never)
    setBossLookField('kitHeld', 'flower')
    expect(patches).toEqual([
      { op: 'set', path: ['kitHeld'], value: 'flower' },
      { op: 'set', path: ['overlayHeld'], value: '' },
    ])
  })
})
