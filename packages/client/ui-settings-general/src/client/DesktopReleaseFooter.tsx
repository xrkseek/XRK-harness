/**
 * Version chip in the Settings foot row (Web + Desktop).
 * Desktop: opens the in-app update sheet when `xrkDesktop` is present.
 * Web: read-only Host package version from `host.describe`.
 * Hidden while reconnect chrome owns the same seat, and on the collapsed rail.
 *
 * Do NOT reuse ConnectionIndicator here: that control always swaps the visible
 * label to `reconnectLabel` on hover — wiring install copy into a checking /
 * downloading phase made "正在检查更新" flip to "安装并重启" before any
 * update was confirmed or downloaded.
 */
import { useEffect, useState, type ReactNode } from 'react'
import {
  Button,
  IconLoadingOutlineRegular,
  Modal,
} from '@xrkseek/client-ui-primitives'
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

export type DesktopReleaseFooterProps = PropsLocale<'settings'> & {
  /** Host package version from `host.describe` (Web / Desktop fallback). */
  readonly hostVersion?: string
}

function clampPercent(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function shortVersion(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  return trimmed.startsWith('v') || trimmed.startsWith('V') ? trimmed.slice(1) : trimmed
}

/** Status pill: one label, optional spinner — no hover text swap. */
function UpdateStatusChip(props: {
  readonly label: string
  readonly ariaLabel: string
  readonly tone: 'progress' | 'ready'
  readonly busy?: boolean
  readonly onClick: () => void
}): ReactNode {
  const { label, ariaLabel, tone, busy = false, onClick } = props
  return (
    <button
      type="button"
      className={tone === 'ready' ? css.statusReady : css.statusProgress}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {busy
        ? (
          <span className={css.statusIcon} aria-hidden="true">
            <IconLoadingOutlineRegular size={14} />
          </span>
        )
        : null}
      <span className={css.statusLabel}>{label}</span>
    </button>
  )
}

/** Compact version pill; Desktop adds update check / install dialog. */
export function DesktopReleaseFooter({ t, hostVersion }: DesktopReleaseFooterProps): ReactNode {
  const bridge = desktopRelease()
  const [installed, setInstalled] = useState(() => shortVersion(hostVersion ?? ''))
  const [state, setState] = useState<DesktopUpdateState>({ phase: 'idle' })
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const fromHost = shortVersion(hostVersion ?? '')
    if (!bridge) {
      setInstalled(fromHost)
      return
    }
    let alive = true
    void bridge.version().then((value) => {
      if (!alive) return
      const next = shortVersion(value)
      setInstalled(next !== '' ? next : fromHost)
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
  }, [bridge, hostVersion])

  if (installed === '') return null

  const versionLabel = t('release.version', { version: installed })

  // Web (and Desktop without update bridge): static short chip.
  if (!bridge) {
    return (
      <span className={css.chip}>
        <span className={css.version} title={versionLabel} aria-label={versionLabel}>
          {versionLabel}
        </span>
      </span>
    )
  }

  const ready = state.phase === 'ready'
  const available = state.phase === 'available' || ready
  const installing = state.phase === 'installing'
  const checking = state.phase === 'checking'
  // Prefetch only — `installing` is quitAndInstall, not another download bar.
  const downloading = state.phase === 'available'
  const shown = (available || installing) && state.version
    ? shortVersion(state.version)
    : installed
  const availableLabel = t('release.available', { version: shown })
  const checkingLabel = t('release.checking')
  const installLabel = t('release.install')
  const installingLabel = t('release.installing')
  const checkLabel = t('release.check', { version: installed })
  const percent = clampPercent(state.percent)
  /** Install only after prefetch finished (coordinator phase `ready`). */
  const canInstall = ready && !installing

  const openSheet = () => {
    setOpen(true)
    if (!bridge) return
    // idle → start check. error → retry check (chip would otherwise stick on
    // failed forever until a background schedule happens to succeed).
    // available/ready/installing/checking already own the sheet content.
    if (state.phase !== 'idle' && state.phase !== 'error') return
    setState({ phase: 'checking' })
    void bridge.updates.check().then((next) => {
      setState(next)
    }).catch((error: unknown) => {
      setState({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    })
  }

  const closeSheet = () => {
    if (installing) return
    setOpen(false)
  }

  const runInstall = () => {
    if (!bridge || !canInstall) return
    setState((current) => ({
      phase: 'installing',
      version: current.version ?? shown,
      percent: 100,
    }))
    void bridge.updates.install().catch(() => undefined)
  }

  let body: ReactNode
  if (state.phase === 'error') {
    body = <p className={css.copy}>{state.message?.trim() || t('release.failed')}</p>
  } else if (installing) {
    body = <p className={css.copy}>{installingLabel}</p>
  } else if (downloading) {
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
  } else if (ready) {
    body = <p className={css.copy}>{t('release.detail', { version: shown })}</p>
  } else {
    body = <p className={css.copy}>{t('release.current', { version: installed })}</p>
  }

  let chip: ReactNode
  if (checking) {
    chip = (
      <UpdateStatusChip
        tone="progress"
        busy
        label={checkingLabel}
        ariaLabel={checkingLabel}
        onClick={openSheet}
      />
    )
  } else if (installing) {
    chip = (
      <UpdateStatusChip
        tone="progress"
        busy
        label={installingLabel}
        ariaLabel={installingLabel}
        onClick={openSheet}
      />
    )
  } else if (state.phase === 'available') {
    // Prefetch in flight — never advertise Install until phase `ready`.
    chip = (
      <UpdateStatusChip
        tone="progress"
        busy
        label={t('release.downloading', { version: shown })}
        ariaLabel={availableLabel}
        onClick={openSheet}
      />
    )
  } else if (ready) {
    chip = (
      <UpdateStatusChip
        tone="ready"
        label={availableLabel}
        ariaLabel={availableLabel}
        onClick={openSheet}
      />
    )
  } else if (state.phase === 'error') {
    // Must not fall through to the idle version pill — that hid real failures.
    chip = (
      <UpdateStatusChip
        tone="ready"
        label={t('release.failed')}
        ariaLabel={t('release.failed')}
        onClick={openSheet}
      />
    )
  } else {
    chip = (
      <button type="button" className={css.hit} onClick={openSheet} aria-label={checkLabel}>
        <span className={css.version} title={versionLabel}>{versionLabel}</span>
      </button>
    )
  }

  return (
    <>
      <div className={css.chip}>{chip}</div>
      <Modal
        open={open}
        onClose={closeSheet}
        title={t('release.title')}
        closeLabel={t('close')}
        layout="inset"
        className={css.dialog}
        contentClassName={css.body}
        footer={(
          <>
            <Button variant="outline" disabled={installing} onClick={closeSheet}>
              {t('release.later')}
            </Button>
            {/* Show Install during prefetch too — disabled until phase `ready`. */}
            {available || installing
              ? (
                <Button
                  variant="primary"
                  disabled={!canInstall}
                  autoFocus={canInstall}
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
