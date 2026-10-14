/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Switch } from '../src/Switch.tsx'

describe('Switch', () => {
  it('exposes role=switch and toggles via onCheckedChange', () => {
    const onCheckedChange = vi.fn()
    render(
      <Switch
        checked={false}
        aria-label="Cron"
        onCheckedChange={onCheckedChange}
      />,
    )
    const control = screen.getByRole('switch', { name: 'Cron' })
    expect(control.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(control)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('stays inert while disabled', () => {
    const onCheckedChange = vi.fn()
    render(
      <Switch
        checked
        aria-label="Voice"
        disabled
        onCheckedChange={onCheckedChange}
      />,
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Voice' }))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
