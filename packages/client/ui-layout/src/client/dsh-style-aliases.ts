/**
 * Dual-publish XRK layout / theme naming onto DSH community CSS / DOM contracts.
 *
 * Community clients (wallpaper-engine glass, better-sidebar, modal masks,
 * deep-whale skins) select Host DOM by DSH attr / CSS-var names. XRK owns
 * `--xrk-*` / `data-xrk-*` / `data-desktop-chrome` / `data-details-*`. Keep
 * both in sync at stamp sites so plugins do not need a fork.
 *
 * Matrix: docs/community-plugin-compat.md §「DOM / CSS 样式命名」.
 *
 * @module
 */

/** Desktop chrome height published by AppFrame (matches CSS default). */
export const DESKTOP_CHROME_HEIGHT_PX = 36

/** DSH desktop shell morph gate (stamped on `<html>`). */
export const DSH_WINDOWS_TITLEBAR_ATTR = 'data-windows-titlebar' as const

/** DSH theme-source gate (stamped on `<html>`). */
export const DSH_THEME_SOURCE_ATTR = 'data-ds-theme-source' as const

/** DSH frame geometry CSS custom properties (documentElement). */
export const DSH_FRAME_CSS = Object.freeze({
  windowsTitlebarHeight: '--dsh-windows-titlebar-height',
  topClearance: '--dsh-frame-top-clearance',
  chromeTop: '--dsh-frame-chrome-top',
  overlayTop: '--dsh-frame-overlay-top',
  leadingClearance: '--dsh-frame-leading-clearance',
} as const)

/** DSH font-size axes community CSS / glass still read. */
export const DSH_FONT_SIZE_CSS = Object.freeze({
  content: '--dsh-content-font-size',
  code: '--dsh-code-font-size',
  terminal: '--dsh-terminal-font-size',
} as const)

/** XRK-owned chrome height (also mirrored to DSH names). */
export const XRK_DESKTOP_CHROME_CSS = '--xrk-desktop-chrome-height' as const

/**
 * Publish or clear desktop-chrome geometry aliases on `document.documentElement`.
 * When active, stamps `data-windows-titlebar` and the DSH frame CSS vars that
 * community layout.css / glass rules expect.
 */
export function applyDesktopChromeDomAliases(
  active: boolean,
  heightPx: number = DESKTOP_CHROME_HEIGHT_PX,
): void {
  const root = document.documentElement
  if (!active) {
    clearDesktopChromeDomAliases()
    return
  }
  const px = `${Math.max(0, Math.round(heightPx))}px`
  root.setAttribute(DSH_WINDOWS_TITLEBAR_ATTR, '')
  root.style.setProperty(XRK_DESKTOP_CHROME_CSS, px)
  root.style.setProperty(DSH_FRAME_CSS.windowsTitlebarHeight, px)
  root.style.setProperty(DSH_FRAME_CSS.topClearance, px)
  root.style.setProperty(DSH_FRAME_CSS.chromeTop, px)
  root.style.setProperty(DSH_FRAME_CSS.overlayTop, `calc(${px} + 20px)`)
}

/** Remove desktop-chrome alias attrs / CSS vars. */
export function clearDesktopChromeDomAliases(): void {
  const root = document.documentElement
  root.removeAttribute(DSH_WINDOWS_TITLEBAR_ATTR)
  root.style.removeProperty(XRK_DESKTOP_CHROME_CSS)
  root.style.removeProperty(DSH_FRAME_CSS.windowsTitlebarHeight)
  root.style.removeProperty(DSH_FRAME_CSS.topClearance)
  root.style.removeProperty(DSH_FRAME_CSS.chromeTop)
  root.style.removeProperty(DSH_FRAME_CSS.overlayTop)
}

/**
 * Mirror the single XRK content font-size onto DSH's three axes so community
 * CSS that reads `--dsh-code-font-size` / `--dsh-terminal-font-size` still
 * resolves. XRK Settings only exposes one content size today.
 */
export function applyDshFontSizeAliases(contentPx: number): void {
  const body = document.body
  const px = `${Math.max(1, Math.round(contentPx))}px`
  body.style.setProperty(DSH_FONT_SIZE_CSS.content, px)
  body.style.setProperty(DSH_FONT_SIZE_CSS.code, px)
  body.style.setProperty(DSH_FONT_SIZE_CSS.terminal, px)
}

/** Stamp `html[data-ds-theme-source]` from preference / resolved scheme. */
export function applyDshThemeSourceAttr(
  preference: 'light' | 'dark' | 'system',
  resolvedScheme: 'light' | 'dark',
): void {
  document.documentElement.setAttribute(
    DSH_THEME_SOURCE_ATTR,
    preference === 'system' ? 'system' : resolvedScheme,
  )
}

export function clearDshThemeSourceAttr(): void {
  document.documentElement.removeAttribute(DSH_THEME_SOURCE_ATTR)
}

/**
 * DOM attr dual-map for stamp sites (XRK native → also stamp DSH name).
 * Used by ConversationRoot / AppFrame / chat seats — keep in sync with the
 * compat matrix.
 */
export const DSH_DOM_ATTR_ALIASES = Object.freeze({
  /** Conversation phase: XRK `data-phase` ↔ DSH `data-content-phase`. */
  contentPhase: 'data-content-phase',
  /** Conversation body: DSH `data-conversation-content`. */
  conversationContent: 'data-conversation-content',
  /** Session id on conversation body: DSH `data-conversation-session`. */
  conversationSession: 'data-conversation-session',
  /** Composer region: DSH `data-conversation-region="composer"`. */
  conversationRegion: 'data-conversation-region',
  /** Session header leading cluster (crumbs / title). */
  conversationHeaderLeading: 'data-conversation-header-leading',
  /** Session view tab strip. */
  conversationTabs: 'data-conversation-tabs',
  /** User bubble face: DSH `data-message-bubble`. */
  messageBubble: 'data-message-bubble',
  /** Think / reasoning row: DSH `data-turn-trigger`. */
  turnTrigger: 'data-turn-trigger',
  /** Process group: DSH `data-turn-process`. */
  turnProcess: 'data-turn-process',
  /** Disclosure header wrapper (maid think/tool chrome). */
  disclosureHeader: 'data-disclosure-header',
  /** Named portal dialog gate (`settings` / `shortcuts`). */
  shortcutModal: 'data-shortcut-modal',
  /** Frame track-toggle animation gate (orca right-panel slide). */
  animating: 'data-animating',
  /** Collapsed-sidebar chrome seat (maid). */
  shellLeading: 'data-shell-leading',
  /** Menu translucent surface: DSH `data-menu-material`. */
  menuMaterial: 'data-menu-material',
  /** Code block banner: DSH `data-code-block-banner`. */
  codeBlockBanner: 'data-code-block-banner',
  /** Right details column as DSH rightbar panel. */
  sidebarRightPanel: 'data-sidebar-right-panel',
  sidebarRightOpen: 'data-sidebar-right-open',
  /** Frame-level rightbar collapsed (DSH `data-rightbar-collapsed`). */
  rightbarCollapsed: 'data-rightbar-collapsed',
  rightbarCol: 'data-rightbar-col',
  /** Boot splash: DSH `data-dsh-boot` / spinner. */
  boot: 'data-dsh-boot',
  bootSpinner: 'data-dsh-boot-spinner',
  /** Composer stats pill id (DSH singular `data-composer-stat`). */
  composerStat: 'data-composer-stat',
  /** Center column alias used by gui-customization. */
  panelConversation: 'data-panel-conversation',
  /** Approval action stamps (endfield / cordis approve chrome). */
  cordisApprove: 'data-cordis-approve',
  cordisDecline: 'data-cordis-decline',
  /** Desktop titlebar drag region (DSH / workbench `data-window-drag`). */
  windowDrag: 'data-window-drag',
  /** Process group activity kind on the fold header (DSH ChatGroupSeat). */
  processActivity: 'data-process-activity',
} as const)

/** DSH content-radius published under desktop chrome (maid frame tuck). */
export const DSH_WINDOWS_CONTENT_RADIUS_CSS = '--dsh-windows-content-radius' as const
