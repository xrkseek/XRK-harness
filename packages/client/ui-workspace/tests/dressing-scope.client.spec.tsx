// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { SettingsScope } from '@xrkseek/client-runtime/client'
import {
  bindDressingHost,
  useBossLook,
  useDressingStickers,
} from '../src/client/dressing-scope.ts'
import { parseStickers, stickersForSlot } from '../src/client/dressing-library.ts'

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
