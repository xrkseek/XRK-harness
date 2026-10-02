// @vitest-environment jsdom
// Modal owns focus for every dialog in the product (CopyDialog, DirectoryBrowser,
// FeedbackDialog, RiskConfirmation, ShortcutsPanel, AgentPresetSection all render
// it), so its three focus duties are a shared contract, not a per-dialog detail:
// focus goes IN when it opens, stays IN while it is open, and comes back to the
// trigger when it closes. These assert all three so a future refactor cannot
// quietly drop one and leave keyboard users stranded.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
})
