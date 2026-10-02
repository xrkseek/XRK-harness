import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { InspectAction } from '../src/InspectAction.tsx'

describe('InspectAction', () => {
  it('renders the label and fires onClick', () => {
    const onClick = vi.fn()
    const view = render(<InspectAction onClick={onClick} />)
    fireEvent.click(view.getByRole('button', { name: 'Inspect' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('accepts a custom label', () => {
    const view = render(<InspectAction onClick={() => {}} label="审阅" />)
    expect(view.getByRole('button', { name: '审阅' })).toBeTruthy()
  })
})
