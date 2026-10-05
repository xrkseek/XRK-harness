// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { SettingsScope } from '@xrkseek/client-runtime/client'
import {
  bindDressingHost,
  useDressingStickers,
} from '../src/client/dressing-scope.ts'
import { parseStickers, stickersForSlot } from '../src/client/dressing-library.ts'

function bind(raw: string | undefined) {
  const scope: SettingsScope<{ stickers?: string }> = {
    load: async () => {},
    subscribe: () => () => {},
    getSnapshot: () => ({ value: { stickers: raw } }),
    set: async () => {},
  }
  bindDressingHost(scope as never)
}

function Probe({ seen }: { seen: unknown[] }) {
  seen.push(useDressingStickers())
  return null
}

describe('useDressingStickers', () => {
  it('returns a stable snapshot while the stickers string is unchanged', () => {
    bind('[]')
    const seen: unknown[] = []
    const view = render(<Probe seen={seen} />)
    view.rerender(<Probe seen={seen} />)
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
