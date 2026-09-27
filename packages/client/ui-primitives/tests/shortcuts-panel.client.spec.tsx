// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ShortcutsPanel } from '@xrkseek/client-ui-primitives'

afterEach(() => {
  cleanup()
})

describe('ShortcutsPanel customize / reset', () => {
  it('arms capture on chord click and exposes per-row + reset-all', () => {
    const onStartCapture = vi.fn()
    const onReset = vi.fn()
    const onResetAll = vi.fn()
    render(
      <ShortcutsPanel
        open
        onClose={() => {}}
        title="Shortcuts"
        closeLabel="Close"
        entries={[
          { id: 'layout.toggleSidebar', keys: 'Ctrl+B', label: 'Toggle sidebar', category: 'Panels', customized: true },
          { id: 'composer.submit', keys: 'Ctrl+Enter', label: 'Send', category: 'Composer', fixed: true },
        ]}
        editable
        capturingId={null}
        onStartCapture={onStartCapture}
        onReset={onReset}
        onResetAll={onResetAll}
        resetLabel="Restore default"
        resetAllLabel="Restore all defaults"
        rebindLabel="Click to rebind"
        pressKeyLabel="Press a key…"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Click to rebind' }))
    expect(onStartCapture).toHaveBeenCalledWith('layout.toggleSidebar')

    fireEvent.click(screen.getByRole('button', { name: 'Restore default' }))
    expect(onReset).toHaveBeenCalledWith('layout.toggleSidebar')

    fireEvent.click(screen.getByRole('button', { name: 'Restore all defaults' }))
    expect(onResetAll).toHaveBeenCalledTimes(1)

    // Fixed rows stay as plain kbd text (no rebind button for Send).
    expect(screen.getByText('Ctrl+Enter').tagName).toBe('KBD')
  })

  it('shows capturing affordance and conflict hint', () => {
    render(
      <ShortcutsPanel
        open
        onClose={() => {}}
        title="Shortcuts"
        closeLabel="Close"
        entries={[
          { id: 'keybinds.openPanel', keys: 'Ctrl+/', label: 'Open panel', category: 'General' },
        ]}
        editable
        capturingId="keybinds.openPanel"
        onStartCapture={() => {}}
        onCancelCapture={() => {}}
        pressKeyLabel="Press a key…"
        rebindLabel="Click to rebind"
        conflictHint='Conflicts with "Send message"'
        onResetAll={() => {}}
        resetAllLabel="Restore all defaults"
      />,
    )
    expect(screen.getByRole('button', { name: 'Click to rebind' }).textContent).toBe('Press a key…')
    expect(screen.getByRole('status').textContent).toContain('Send message')
    expect(screen.getByRole('button', { name: 'Restore all defaults' }).hasAttribute('disabled')).toBe(true)
  })
})
