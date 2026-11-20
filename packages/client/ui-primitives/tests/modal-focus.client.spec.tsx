// @vitest-environment jsdom
// Modal owns focus for every dialog in the product (CopyDialog, DirectoryBrowser,
// FeedbackDialog, RiskConfirmation, ShortcutsPanel, AgentPresetSection all render
// it), so its three focus duties are a shared contract, not a per-dialog detail:
// focus goes IN when it opens, stays IN while it is open, and comes back to the
// trigger when it closes. These assert all three so a future refactor cannot
// quietly drop one and leave keyboard users stranded.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Modal } from '@xrkseek/client-ui-primitives'

afterEach(() => {
  cleanup()
})

function opener() {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = 'open'
  document.body.appendChild(button)
  return button
}

const tab = (shift = false) =>
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: shift, bubbles: true })

describe('Modal focus management', () => {
  it('moves focus into the dialog on open, preferring the first field', () => {
    opener()
    render(
      <Modal open onClose={() => {}} title="Create" closeLabel="Close">
        <input aria-label="name" />
      </Modal>,
    )
    // Not the close button: a dialog whose first act is typing should start there.
    expect(document.activeElement).toBe(screen.getByLabelText('name'))
  })

  it('traps Tab inside the dialog instead of letting it reach the page behind', () => {
    opener()
    render(
      <Modal open onClose={() => {}} title="Create" closeLabel="Close">
        <input aria-label="name" />
        <button type="button">Save</button>
      </Modal>,
    )
    const name = screen.getByLabelText('name')
    const save = screen.getByRole('button', { name: 'Save' })
    const close = screen.getByRole('button', { name: 'Close' })

    // Park on the LAST stop, then Tab: the trap must wrap, not fall through.
    save.focus()
    tab()
    expect(document.activeElement).toBe(close)

    // And from the FIRST stop, Shift+Tab must wrap backwards.
    close.focus()
    tab(true)
    expect(document.activeElement).toBe(save)

    expect(document.body.contains(name)).toBe(true)
  })

  it('keeps focus on the container when the dialog holds nothing focusable', () => {
    render(
      <Modal open onClose={() => {}} title="Notice" closeLabel="Close" headless>
        <p>Read me.</p>
      </Modal>,
    )
    // headless drops the close button, so the dialog itself must be the stop,
    // otherwise focus silently stays behind the overlay.
    expect(document.activeElement?.getAttribute('role')).toBe('dialog')
    tab()
    expect(document.activeElement?.getAttribute('role')).toBe('dialog')
  })

  it('marks short confirms with data-layout=inset (phone contract)', () => {
    // Callers of delete / error / retry dialogs must pass layout="inset".
    // Phone CSS then centers the card and keyboard-lifts it — never a
    // full-bleed sheet or a bottom-glued system confirm.
    render(
      <Modal open onClose={() => {}} title="Delete" closeLabel="Close" layout="inset">
        <p>Remove this workspace?</p>
      </Modal>,
    )
    const root = document.querySelector('[role="dialog"]')?.parentElement
    expect(root?.getAttribute('data-layout')).toBe('inset')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('leaves form dialogs on the default layout (no data-layout stamp)', () => {
    render(
      <Modal open onClose={() => {}} title="Create" closeLabel="Close">
        <input aria-label="name" />
      </Modal>,
    )
    const root = document.querySelector('[role="dialog"]')?.parentElement
    expect(root?.getAttribute('data-layout')).toBeNull()
  })

  it('mirrors the Flutter #root pin onto body-portaled overlays', () => {
    // APP shell shortens #root and zeroes --xrk-keyboard-inset. Without this
    // sync, rename / create dialogs sit under the IME.
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    Object.defineProperty(appRoot, 'getBoundingClientRect', {
      value: () => ({
        top: 0, left: 0, right: 390, bottom: 500,
        width: 390, height: 500, x: 0, y: 0, toJSON: () => ({}),
      }),
    })
    document.body.appendChild(appRoot)
    document.documentElement.setAttribute('data-xrk-shell-keyboard', '')
    const prevInner = window.innerHeight
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })

    try {
      render(
        <Modal open onClose={() => {}} title="Rename" closeLabel="Close" layout="inset">
          <input aria-label="name" />
        </Modal>,
      )
      const overlay = document.querySelector('[role="dialog"]')?.parentElement as HTMLElement
      expect(overlay.style.bottom).toBe('300px')
      expect(overlay.style.top).toBe('0px')
    } finally {
      document.documentElement.removeAttribute('data-xrk-shell-keyboard')
      appRoot.remove()
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: prevInner })
    }
  })

  it('restores focus to the trigger on close', () => {
    const trigger = opener()
    trigger.focus()
    const onClose = vi.fn()
    const { rerender } = render(
      <Modal open onClose={onClose} title="Create" closeLabel="Close">
        <input aria-label="name" />
      </Modal>,
    )
    expect(document.activeElement).not.toBe(trigger)

    rerender(
      <Modal open={false} onClose={onClose} title="Create" closeLabel="Close">
        <input aria-label="name" />
      </Modal>,
    )
    expect(document.activeElement).toBe(trigger)
  })

  it('closes on Escape without disturbing the focus contract', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Create" closeLabel="Close">
        <input aria-label="name" />
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape', bubbles: true })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // ZCode's motion rule (DESIGN.md §Motion): the transition explains the state
  // change instead of the element disappearing on the same frame `open` flips.
  // The card therefore has to survive one exit window, and must not survive it
  // when the user asked for less motion.
  it('keeps the card for the exit window, then unmounts', () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <Modal open onClose={() => {}} title="Exit">body</Modal>,
    )
    expect(document.querySelector('[data-state="open"]')).not.toBeNull()

    rerender(<Modal open={false} onClose={() => {}} title="Exit">body</Modal>)
    // Still mounted, now in the closing phase, so the fade can play.
    expect(document.querySelector('[data-state="closing"]')).not.toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeNull()

    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.queryByRole('dialog')).toBeNull()
    vi.useRealTimers()
  })
})
