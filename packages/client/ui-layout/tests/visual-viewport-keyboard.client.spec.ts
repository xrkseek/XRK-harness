import { afterEach, describe, expect, it } from 'vitest'
import {
  KEYBOARD_INSET_CSS,
  SHELL_KEYBOARD_ATTR,
  bindVisualViewportKeyboard,
  computeKeyboardInsetPx,
  sanitizeKeyboardInsetPx,
} from '../src/client/visual-viewport-keyboard.ts'

describe('computeKeyboardInsetPx', () => {
  it('returns 0 when the visual viewport fills the layout height', () => {
    expect(computeKeyboardInsetPx(800, 800, 0)).toBe(0)
  })

  it('returns the covered band for an overlay keyboard', () => {
    expect(computeKeyboardInsetPx(800, 480, 0)).toBe(320)
  })

  it('subtracts visualViewport.offsetTop (iOS URL chrome / scrolled VV)', () => {
    expect(computeKeyboardInsetPx(800, 480, 40)).toBe(280)
  })

  it('clamps negative / non-finite to 0', () => {
    expect(computeKeyboardInsetPx(800, 900, 0)).toBe(0)
    expect(computeKeyboardInsetPx(Number.NaN, 480, 0)).toBe(0)
  })
})

describe('sanitizeKeyboardInsetPx', () => {
  it('zeros wide / desktop windows (post-wake VV collapse must not lift composer)', () => {
    expect(sanitizeKeyboardInsetPx(200, 1280, 800)).toBe(0)
    expect(sanitizeKeyboardInsetPx(200, 768, 800)).toBe(0)
  })

  it('keeps a plausible phone OSK band on narrow web', () => {
    expect(sanitizeKeyboardInsetPx(280, 390, 844)).toBe(280)
  })

  it('keeps OSK under phone chrome even when width crosses PHONE_MAX', () => {
    expect(sanitizeKeyboardInsetPx(280, 900, 844, { phoneChrome: true })).toBe(280)
  })

  it('drops absurd fractions (wake collapse often >45% of height)', () => {
    expect(sanitizeKeyboardInsetPx(600, 390, 800)).toBe(0)
    expect(sanitizeKeyboardInsetPx(600, 900, 800, { phoneChrome: true })).toBe(0)
  })
})

describe('bindVisualViewportKeyboard shell isolation', () => {
  afterEach(() => {
    document.documentElement.removeAttribute(SHELL_KEYBOARD_ATTR)
    document.documentElement.style.removeProperty(KEYBOARD_INSET_CSS)
  })

  it('does not overwrite inset while the Flutter shell claims ownership', async () => {
    const root = document.documentElement
    root.setAttribute(SHELL_KEYBOARD_ATTR, '')
    root.style.setProperty(KEYBOARD_INSET_CSS, '0px')
    const unbind = bindVisualViewportKeyboard(root)
    const input = document.createElement('textarea')
    document.body.appendChild(input)
    input.focus()
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
    expect(root.style.getPropertyValue(KEYBOARD_INSET_CSS)).toBe('0px')
    input.blur()
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
    expect(root.style.getPropertyValue(KEYBOARD_INSET_CSS)).toBe('0px')
    expect(root.hasAttribute(SHELL_KEYBOARD_ATTR)).toBe(true)
    input.remove()
    unbind()
  })

  it('forces inset to 0 when the Flutter shell claims ownership mid-session', async () => {
    const root = document.documentElement
    root.style.setProperty(KEYBOARD_INSET_CSS, '200px')
    const unbind = bindVisualViewportKeyboard(root)
    root.setAttribute(SHELL_KEYBOARD_ATTR, '')
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
    expect(root.style.getPropertyValue(KEYBOARD_INSET_CSS)).toBe('0px')
    unbind()
  })
})
