/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { useRef, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
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

  it('lets a host-owned toggle close without outside-click racing reopen', () => {
    function Parent() {
      const [open, setOpen] = useState(true)
      const ignoreRef = useRef<HTMLButtonElement | null>(null)
      return (
        <>
          <button
            ref={ignoreRef}
            type="button"
            aria-expanded={open}
            onClick={() => { setOpen((v) => !v) }}
          >
            toggle
          </button>
          <Menu
            open={open}
            portal
            dense
            anchor={null}
            outsideIgnoreRef={ignoreRef}
            getAnchorRect={() => ignoreRef.current?.getBoundingClientRect() ?? null}
            onClose={() => { setOpen(false) }}
            onSelect={() => { setOpen(false) }}
            items={[{ id: 'a', label: 'A' }]}
          />
        </>
      )
    }
    render(<Parent />)
    expect(screen.getByRole('menuitem', { name: 'A' })).toBeTruthy()
    const toggle = screen.getByRole('button', { name: 'toggle' })
    // pointerdown on the host toggle must not close before the click toggles.
    fireEvent.pointerDown(toggle)
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menuitem', { name: 'A' })).toBeNull()
  })
})
