// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyDesktopChromeDomAliases,
  applyDshFontSizeAliases,
  applyDshThemeSourceAttr,
  clearDesktopChromeDomAliases,
  clearDshThemeSourceAttr,
  DESKTOP_CHROME_HEIGHT_PX,
  DSH_DOM_ATTR_ALIASES,
  DSH_FONT_SIZE_CSS,
  DSH_FRAME_CSS,
  DSH_THEME_SOURCE_ATTR,
  DSH_WINDOWS_CONTENT_RADIUS_CSS,
  DSH_WINDOWS_TITLEBAR_ATTR,
  XRK_DESKTOP_CHROME_CSS,
} from '../src/client/dsh-style-aliases.ts'

afterEach(() => {
  clearDesktopChromeDomAliases()
  clearDshThemeSourceAttr()
  document.body.removeAttribute('style')
})

describe('dsh-style-aliases', () => {
  it('dual-publishes desktop chrome as DSH windows-titlebar + frame vars', () => {
    applyDesktopChromeDomAliases(true)
    const root = document.documentElement
    expect(root.hasAttribute(DSH_WINDOWS_TITLEBAR_ATTR)).toBe(true)
    expect(root.style.getPropertyValue(XRK_DESKTOP_CHROME_CSS)).toBe(`${DESKTOP_CHROME_HEIGHT_PX}px`)
    expect(root.style.getPropertyValue(DSH_FRAME_CSS.windowsTitlebarHeight)).toBe(
      `${DESKTOP_CHROME_HEIGHT_PX}px`,
    )
    expect(root.style.getPropertyValue(DSH_FRAME_CSS.chromeTop)).toBe(
      `${DESKTOP_CHROME_HEIGHT_PX}px`,
    )
    expect(root.style.getPropertyValue(DSH_FRAME_CSS.overlayTop)).toContain('calc')
    clearDesktopChromeDomAliases()
    expect(root.hasAttribute(DSH_WINDOWS_TITLEBAR_ATTR)).toBe(false)
    expect(root.style.getPropertyValue(DSH_FRAME_CSS.windowsTitlebarHeight)).toBe('')
  })

  it('mirrors content font size onto DSH code/terminal axes', () => {
    applyDshFontSizeAliases(16)
    expect(document.body.style.getPropertyValue(DSH_FONT_SIZE_CSS.content)).toBe('16px')
    expect(document.body.style.getPropertyValue(DSH_FONT_SIZE_CSS.code)).toBe('16px')
    expect(document.body.style.getPropertyValue(DSH_FONT_SIZE_CSS.terminal)).toBe('16px')
  })

  it('stamps html[data-ds-theme-source] from preference', () => {
    applyDshThemeSourceAttr('system', 'dark')
    expect(document.documentElement.getAttribute(DSH_THEME_SOURCE_ATTR)).toBe('system')
    applyDshThemeSourceAttr('dark', 'dark')
    expect(document.documentElement.getAttribute(DSH_THEME_SOURCE_ATTR)).toBe('dark')
  })

  it('exposes skin-critical DOM attr alias names', () => {
    expect(DSH_DOM_ATTR_ALIASES.disclosureHeader).toBe('data-disclosure-header')
    expect(DSH_DOM_ATTR_ALIASES.shortcutModal).toBe('data-shortcut-modal')
    expect(DSH_DOM_ATTR_ALIASES.animating).toBe('data-animating')
    expect(DSH_DOM_ATTR_ALIASES.shellLeading).toBe('data-shell-leading')
    expect(DSH_DOM_ATTR_ALIASES.conversationHeaderLeading).toBe('data-conversation-header-leading')
    expect(DSH_DOM_ATTR_ALIASES.conversationTabs).toBe('data-conversation-tabs')
    expect(DSH_WINDOWS_CONTENT_RADIUS_CSS).toBe('--dsh-windows-content-radius')
  })
})
