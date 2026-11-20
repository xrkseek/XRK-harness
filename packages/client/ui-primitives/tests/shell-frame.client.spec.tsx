// @vitest-environment jsdom
// Body-portaled overlays must share one Flutter `#root` pin contract. These
// cover the helper itself so Modal / Settings / lightbox cannot drift apart.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import {
  SHELL_KEYBOARD_ATTR,
  clearOverlayShellFrame,
  syncOverlayToAppRoot,
  useShellFrameOverlay,
} from '../src/shell-frame.ts'

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute(SHELL_KEYBOARD_ATTR)
  document.getElementById('root')?.remove()
})

function mountRoot(bottom = 500): HTMLDivElement {
  const appRoot = document.createElement('div')
  appRoot.id = 'root'
  Object.defineProperty(appRoot, 'getBoundingClientRect', {
    value: () => ({
      top: 0, left: 0, right: 390, bottom,
      width: 390, height: bottom, x: 0, y: 0, toJSON: () => ({}),
    }),
  })
  document.body.appendChild(appRoot)
  return appRoot
}

describe('shell-frame', () => {
  it('pins overlay edges to #root while the Flutter shell owns keyboard layout', () => {
    mountRoot(520)
    document.documentElement.setAttribute(SHELL_KEYBOARD_ATTR, '')
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })

    const overlay = document.createElement('div')
    document.body.appendChild(overlay)
    syncOverlayToAppRoot(overlay)

    expect(overlay.style.top).toBe('0px')
    expect(overlay.style.left).toBe('0px')
    expect(overlay.style.right).toBe('0px')
    expect(overlay.style.bottom).toBe('280px')
    overlay.remove()
  })

  it('clears inline edges when the shell attr is absent (browser / Desktop)', () => {
    mountRoot(520)
    const overlay = document.createElement('div')
    overlay.style.top = '10px'
    overlay.style.bottom = '40px'
    document.body.appendChild(overlay)

    syncOverlayToAppRoot(overlay)
    expect(overlay.style.top).toBe('')
    expect(overlay.style.bottom).toBe('')
    clearOverlayShellFrame(overlay)
    overlay.remove()
  })

  it('useShellFrameOverlay keeps the pin live and clears on unmount', () => {
    mountRoot(500)
    document.documentElement.setAttribute(SHELL_KEYBOARD_ATTR, '')
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })

    function Probe({ active }: { active: boolean }) {
      const ref = useRef<HTMLDivElement | null>(null)
      useShellFrameOverlay(ref, active)
      return <div ref={ref} data-testid="overlay" />
    }

    const { rerender, unmount } = render(<Probe active />)
    const overlay = document.querySelector('[data-testid="overlay"]') as HTMLElement
    expect(overlay.style.bottom).toBe('300px')

    rerender(<Probe active={false} />)
    expect(overlay.style.bottom).toBe('')

    rerender(<Probe active />)
    expect(overlay.style.bottom).toBe('300px')
    unmount()
  })
})
