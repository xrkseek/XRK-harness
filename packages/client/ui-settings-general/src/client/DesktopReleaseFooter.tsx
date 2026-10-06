/**
 * Desktop update notice in the same Settings-foot slot as Host reconnect chrome.
 * Hidden on web, on the collapsed rail, and while a connection indicator is up.
 * Confirm / progress use the in-page Modal (not Electron native dialogs).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, ConnectionIndicator, Modal } from '@xrkseek/client-ui-primitives'
import type { PropsLocale } from '@xrkseek/client-ui-slots'
import css from './DesktopReleaseFooter.module.css'

type UpdatePhase = 'idle' | 'checking' | 'available' | 'installing' | 'ready' | 'error'

interface DesktopUpdateState {
  readonly phase: UpdatePhase
  readonly version?: string
  readonly message?: string
  readonly percent?: number
}

interface DesktopReleaseBridge {
  version(): Promise<string>
  updates: {
    check(): Promise<DesktopUpdateState>
    snapshot(): Promise<DesktopUpdateState>
    install(): Promise<void>
    subscribe(listener: (state: DesktopUpdateState) => void): () => void
  }
}

function desktopRelease(): DesktopReleaseBridge | undefined {
  const root = (globalThis as { xrkDesktop?: DesktopReleaseBridge }).xrkDesktop
  if (root?.version === undefined || root.updates === undefined) return undefined
  return root
}

export type DesktopReleaseFooterProps = PropsLocale<'settings'>

const NOOP = () => {}

function clampPercent(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

/** Host-reconnect-shaped chip plus in-app update dialog. */
export function DesktopReleaseFooter({ t }: DesktopReleaseFooterProps): ReactNode {
  const bridge = desktopRelease()
  const [installed, setInstalled] = useState('')
  const [state, setState] = useState<DesktopUpdateState>({ phase: 'idle' })
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!bridge) return
    let alive = true
    void bridge.version().then((value) => {
      if (alive && value.trim() !== '') setInstalled(value.trim())
    })
    void bridge.updates.snapshot().then((next) => {
      if (alive) setState(next)
    })
    const off = bridge.updates.subscribe((next) => {
      if (alive) setState(next)
    })
    return () => {
      alive = false
      off()
    }
  }, [bridge])

  if (!bridge || installed === '') return null

  const available = state.phase === 'available' || state.phase === 'ready'
  const installing = state.phase === 'installing'
  const checking = state.phase === 'checking'
  const shown = available && state.version ? state.version : installed
  const versionLabel = t('release.version', { version: installed })
  const availableLabel = t('release.available', { version: shown })
  const checkingLabel = t('release.checking')
  const installLabel = t('release.install')
  const checkLabel = t('release.check', { version: installed })
  const percent = clampPercent(state.percent)

  const openSheet = () => {
    setOpen(true)
    if (!bridge) return
    if (available || installing) return
    void bridge.updates.check().then((next) => {
      setState(next)
    })
  }

  const closeSheet = () => {
    if (installing) return
    setOpen(false)
  }

  const runInstall = () => {
    if (!bridge || (!available && !installing)) return
    setState((current) => ({
      phase: 'installing',
      version: current.version ?? shown,
      percent: clampPercent(current.percent),
    }))
    void bridge.updates.install().catch(() => undefined)
  }

  let body: ReactNode
  if (state.phase === 'error') {
    body = <p className={css.copy}>{state.message?.trim() || t('release.failed')}</p>
  } else if (installing || (open && available && percent > 0)) {
    body = (
      <>
        <p className={css.copy}>{t('release.downloading', { version: state.version ?? shown })}</p>
        <div
          className={css.meter}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={t('release.progress', { percent })}
        >
          <span className={css.fill} style={{ width: `${percent}%` }} />
        </div>
        <p className={css.percent}>{t('release.progress', { percent })}</p>
      </>
    )
  } else if (checking) {
    body = <p className={css.copy}>{checkingLabel}</p>
  } else if (available) {
    body = <p className={css.copy}>{t('release.detail', { version: shown })}</p>
  } else {
    body = <p className={css.copy}>{t('release.current', { version: installed })}</p>
  }

  const chip = checking || installing
    ? (
      <ConnectionIndicator
        state="connecting"
        disconnectedLabel={availableLabel}
        reconnectLabel={installLabel}
        connectingLabel={installing ? t('release.downloading', { version: shown }) : checkingLabel}
        phaseLabel={installing ? t('release.progress', { percent }) : checkingLabel}
        recoveredLabel={versionLabel}
        reconnectActionLabel={checkLabel}
        restartActionLabel={checkingLabel}
        onReconnect={openSheet}
      />
    )
    : available
      ? (
        <ConnectionIndicator
          state="disconnected"
          disconnectedLabel={availableLabel}
          reconnectLabel={installLabel}
          connectingLabel={checkingLabel}
          recoveredLabel={versionLabel}
          reconnectActionLabel={availableLabel}
          restartActionLabel={checkingLabel}
          onReconnect={openSheet}
        />
      )
      : (
        <button type="button" className={css.hit} onClick={openSheet} aria-label={checkLabel}>
          <ConnectionIndicator
            state="recovered"
            disconnectedLabel={availableLabel}
            reconnectLabel={checkLabel}
            connectingLabel={checkingLabel}
            recoveredLabel={versionLabel}
            reconnectActionLabel={checkLabel}
            restartActionLabel={checkingLabel}
            onReconnect={NOOP}
          />
        </button>
      )

  return (
    <>
      {chip}
      <Modal
        open={open}
        onClose={closeSheet}
        title={t('release.title')}
        closeLabel={t('close')}
        className={css.dialog}
        contentClassName={css.body}
        footer={(
          <>
            <Button variant="outline" disabled={installing} onClick={closeSheet}>
              {t('release.later')}
            </Button>
            {available || installing
              ? (
                <Button
                  variant="primary"
                  disabled={installing}
                  autoFocus={available}
                  onClick={runInstall}
                >
                  {installLabel}
                </Button>
              )
              : null}
          </>
        )}
      >
        {body}
      </Modal>
    </>
  )
}
