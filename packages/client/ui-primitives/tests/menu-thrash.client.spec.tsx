/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, render } from '@testing-library/react'
import { Menu } from '../src/Menu.tsx'

describe('Menu thrash', () => {
  it('does not tip React #185 when closed and onClose identity churns', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Parent({ nonce }: { nonce: number }) {
      const [open, setOpen] = useState(false)
      void nonce
      return (
        <Menu
          open={open}
          portal
          dense
          onClose={() => { setOpen(false) }}
          onSelect={() => { setOpen(false) }}
          items={[{ id: 'a', label: 'A' }]}
          anchor={<button type="button">x</button>}
        />
      )
    }
    const view = render(<Parent nonce={0} />)
    expect(() => {
      for (let i = 1; i <= 60; i++) {
        act(() => {
          view.rerender(<Parent nonce={i} />)
        })
      }
    }).not.toThrow()
    const depth = spy.mock.calls.some((args) =>
      args.some((arg) => String(arg).includes('Maximum update depth')),
    )
    spy.mockRestore()
    expect(depth).toBe(false)
  })
})
