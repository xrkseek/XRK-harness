/**
 * Frameless Desktop window controls for the HARNESS splash.
 * Kernel-owned (no locale / ui-layout plugin): mirrors DesktopChrome so the
 * user can reload / minimize / close while Host + sessions are still gating.
 * Unmounts with the splash; AppFrame's DesktopChrome takes over after settle.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { BootLang } from './boot-hints.ts'
import css from './BootWindowChrome.module.css'

interface DesktopWindowBridge {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  subscribeMaximized(listener: (maximized: boolean) => void): () => void
  reload(): Promise<void>
}

function desktopWindow():
  | { window: DesktopWindowBridge; platform?: string }
  | undefined {
  const root = (globalThis as {
    xrkDesktop?: { window?: DesktopWindowBridge; platform?: string }
  }).xrkDesktop
  if (root?.window === undefined) return undefined
  return root as { window: DesktopWindowBridge; platform?: string }
}

const LABELS = {
  en: {
    reload: 'Reload',
    minimize: 'Minimize',
    maximize: 'Maximize',
    restore: 'Restore',
    close: 'Close',
  },
  zh: {
    reload: '刷新',
    minimize: '最小化',
    maximize: '最大化',
    restore: '还原',
    close: '关闭',
  },
} as const

/** Splash-time titlebar controls (Desktop only). */
export function BootWindowChrome({ lang }: { readonly lang: BootLang }): ReactNode {
  const api = desktopWindow()
  const bridge = api?.window
  const darwin = api?.platform === 'darwin'
  const [maximized, setMaximized] = useState(false)
  const copy = LABELS[lang]

  useEffect(() => {
    if (!bridge) return
    let alive = true
    void bridge.isMaximized().then((value) => {
      if (alive) setMaximized(value)
    })
    return bridge.subscribeMaximized((value) => {
      if (alive) setMaximized(value)
    })
  }, [bridge])

  if (!bridge) return null

  return (
    <div
      className={css.chrome}
      data-desktop-chrome=""
      data-boot-chrome=""
      data-platform={api?.platform ?? 'unknown'}
    >
      {darwin ? <div className={css.trafficPad} aria-hidden /> : null}
      <div
        className={css.drag}
        onDoubleClick={() => { void bridge.toggleMaximize() }}
      />
      <div className={css.actions}>
        <button
          type="button"
          className={css.action}
          aria-label={copy.reload}
          title={copy.reload}
          onClick={() => { void bridge.reload() }}
        >
          <span className={css.reloadGlyph} aria-hidden />
        </button>
        {darwin ? null : (
          <>
            <button
              type="button"
              className={css.action}
              aria-label={copy.minimize}
              title={copy.minimize}
              onClick={() => { void bridge.minimize() }}
            >
              <span className={css.minimizeGlyph} aria-hidden />
            </button>
            <button
              type="button"
              className={css.action}
              aria-label={maximized ? copy.restore : copy.maximize}
              title={maximized ? copy.restore : copy.maximize}
              onClick={() => { void bridge.toggleMaximize() }}
            >
              <span
                className={maximized ? css.restoreGlyph : css.maximizeGlyph}
                aria-hidden
              />
            </button>
            <button
              type="button"
              className={`${css.action} ${css.close}`}
              aria-label={copy.close}
              title={copy.close}
              onClick={() => { void bridge.close() }}
            >
              <span className={css.closeGlyph} aria-hidden />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
