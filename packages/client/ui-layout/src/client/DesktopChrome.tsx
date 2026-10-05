/**
 * Frameless Desktop shell chrome: full-width thin titlebar above the shell,
 * drag region, reload, and window controls on the right.
 * Renders only when `window.xrkDesktop.window` is present (Electron preload).
 *
 * Darwin uses Electron `hiddenInset` traffic lights — custom min/max/close are
 * omitted so a second control set is not painted over the system lights.
 *
 * Window controls stay fixed to the viewport top-right (like a normal OS
 * window) so community sidebar layout-push cannot shove them off the edge.
 */

import { useEffect, useState, type ReactNode } from 'react'
import {
  IconCloseOutline16,
  IconRefreshOutline16,
  Tooltip,
} from '@xrkseek/client-ui-primitives'
import type { PropsLocale } from '@xrkseek/client-ui-slots'
import css from './DesktopChrome.module.css'

/** Narrow bridge face used by the chrome (mirrors apps/desktop XrkDesktopWindowApi). */
interface DesktopWindowBridge {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  subscribeMaximized(listener: (maximized: boolean) => void): () => void
  reload(): Promise<void>
}

function desktopApi():
  | { window: DesktopWindowBridge; platform?: string }
  | undefined {
  const root = (globalThis as {
    xrkDesktop?: { window?: DesktopWindowBridge; platform?: string }
  }).xrkDesktop
  if (root?.window === undefined) return undefined
  return root as { window: DesktopWindowBridge; platform?: string }
}

export type DesktopChromeProps = PropsLocale<'layout'>

/** Product titlebar for the frameless Electron shell. */
export function DesktopChrome({ t }: DesktopChromeProps): ReactNode {
  const api = desktopApi()
  const bridge = api?.window
  const darwin = api?.platform === 'darwin'
  const [maximized, setMaximized] = useState(false)

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
      data-desktop-chrome
      data-platform={api?.platform ?? 'unknown'}
    >
      {darwin ? <div className={css.trafficPad} aria-hidden /> : null}
      <div
        className={css.drag}
        onDoubleClick={() => { void bridge.toggleMaximize() }}
      />
      <div className={css.actions}>
        <Tooltip label={t('desktop.reload')} side="bottom">
          <button
            type="button"
            className={css.action}
            aria-label={t('desktop.reload')}
            onClick={() => { void bridge.reload() }}
          >
            <IconRefreshOutline16 size={14} />
          </button>
        </Tooltip>
        {darwin ? null : (
          <>
            <Tooltip label={t('desktop.minimize')} side="bottom">
              <button
                type="button"
                className={css.action}
                aria-label={t('desktop.minimize')}
                onClick={() => { void bridge.minimize() }}
              >
                <span className={css.minimizeGlyph} aria-hidden />
              </button>
            </Tooltip>
            <Tooltip label={maximized ? t('desktop.restore') : t('desktop.maximize')} side="bottom">
              <button
                type="button"
                className={css.action}
                aria-label={maximized ? t('desktop.restore') : t('desktop.maximize')}
                onClick={() => { void bridge.toggleMaximize() }}
              >
                <span
                  className={maximized ? css.restoreGlyph : css.maximizeGlyph}
                  aria-hidden
                />
              </button>
            </Tooltip>
            <Tooltip label={t('desktop.close')} side="bottom">
              <button
                type="button"
                className={`${css.action} ${css.close}`}
                aria-label={t('desktop.close')}
                onClick={() => { void bridge.close() }}
              >
                <IconCloseOutline16 size={14} />
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  )
}

/** Whether the shell should reserve space for {@link DesktopChrome}. */
export function hasDesktopChrome(): boolean {
  return desktopApi()?.window !== undefined
}
