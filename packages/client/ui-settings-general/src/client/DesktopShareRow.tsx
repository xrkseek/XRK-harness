/**
 * Desktop General row: temporary LAN / tunnel share (0.0.0.0 gateway + PIN).
 * Hidden unless Host reports `desktopLanShare` (XRK_SURFACE=desktop).
 * Switch row shares SidebarAgentPushRows chrome; detail panel is local.
 */
import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { Button, Switch, writeClipboard } from '@xrkseek/client-ui-primitives'
import rowCss from './SidebarAgentPushRows.module.css'
import css from './DesktopShareRow.module.css'

export type DesktopShareRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings'>

interface ShareControl {
  readonly running: boolean
  readonly desktopLanShare?: boolean
  readonly origin?: string
  readonly localOrigin?: string
  readonly pin?: string
  readonly wanPin?: string
  readonly lanPin?: string
  readonly sharePort?: number
  readonly hostLoopbackOrigin?: string
  readonly qrSvg?: string
  readonly lanHosts?: readonly string[]
  readonly lanIp?: string
}

async function fetchControl(
  init?: RequestInit,
): Promise<ShareControl | undefined> {
  const res = await fetch('/api/mobile-access/control', {
    credentials: 'same-origin',
    ...init,
  })
  if (!res.ok) return undefined
  return (await res.json()) as ShareControl
}

function isDesktopShell(): boolean {
  return (
    (globalThis as { xrkDesktop?: unknown }).xrkDesktop !== undefined
  )
}

function CopyField({
  label,
  value,
  emphasize,
  copyLabel,
  copiedLabel,
  hint,
}: {
  label: string
  value: string
  emphasize?: boolean
  copyLabel: string
  copiedLabel: string
  hint?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className={css.field}>
      <div className={css.label}>{label}</div>
      <div className={css.valueRow}>
        <code className={emphasize ? css.monoPin : css.mono}>{value}</code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={copyLabel}
          onClick={() => {
            void writeClipboard(value).then((ok) => {
              if (!ok) return
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1600)
            })
          }}
        >
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>
      {hint ? <p className={css.fieldHint}>{hint}</p> : null}
    </div>
  )
}

/** Switch + address / PIN / QR for Desktop temporary share. */
export function DesktopShareRow({ t }: DesktopShareRowProps) {
  const [ready, setReady] = useState(false)
  const [supported, setSupported] = useState(false)
  const [running, setRunning] = useState(false)
  const [origin, setOrigin] = useState('')
  const [localOrigin, setLocalOrigin] = useState('')
  const [pin, setPin] = useState('')
  const [sharePort, setSharePort] = useState<number | undefined>()
  const [qrSvg, setQrSvg] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  const apply = useCallback((body: ShareControl) => {
    // Desktop shell must keep the row even when an older Host omits the flag.
    setSupported(body.desktopLanShare === true || isDesktopShell())
    setRunning(body.running === true)
    setOrigin(typeof body.origin === 'string' ? body.origin : '')
    const port =
      typeof body.sharePort === 'number' ? body.sharePort : undefined
    setSharePort(port)
    const local =
      (typeof body.localOrigin === 'string' && body.localOrigin) ||
      (port !== undefined ? `http://127.0.0.1:${String(port)}` : '')
    setLocalOrigin(local)
    const nextPin =
      (typeof body.pin === 'string' && body.pin) ||
      (typeof body.wanPin === 'string' && body.wanPin) ||
      (typeof body.lanPin === 'string' && body.lanPin) ||
      ''
    setPin(nextPin)
    setQrSvg(typeof body.qrSvg === 'string' ? body.qrSvg : '')
  }, [])

  useEffect(() => {
    let alive = true
    void fetchControl()
      .then((body) => {
        if (!alive) return
        if (body?.desktopLanShare === true || isDesktopShell()) {
          if (body) apply(body)
          else setSupported(isDesktopShell())
        }
        setReady(true)
      })
      .catch(() => {
        if (alive) {
          setSupported(isDesktopShell())
          setReady(true)
        }
      })
    return () => {
      alive = false
    }
  }, [apply])

  if (!ready || !supported) return null

  return (
    <div className={css.block}>
      <div className={`${rowCss.row} ${css.rowFlush}`}>
        <div className={rowCss.rowText}>
          <div className={rowCss.title}>{t('desktopShare.title')}</div>
          <div className={rowCss.desc}>
            {error ? t('desktopShare.saveFailed') : t('desktopShare.description')}
          </div>
        </div>
        <Switch
          checked={running}
          disabled={busy}
          aria-label={t('desktopShare.title')}
          onCheckedChange={(next) => {
            const previous = running
            setRunning(next)
            setBusy(true)
            setError(false)
            void fetchControl({
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ running: next }),
            })
              .then((body) => {
                if (!body) throw new Error('control_failed')
                apply(body)
              })
              .catch(() => {
                setRunning(previous)
                setError(true)
              })
              .finally(() => {
                setBusy(false)
              })
          }}
        />
      </div>

      {running ? (
        <div className={css.detail}>
          <div className={css.detailMain}>
            <div className={css.fields}>
              {localOrigin ? (
                <CopyField
                  label={t('desktopShare.localUrl')}
                  value={localOrigin}
                  hint={t('desktopShare.localHint')}
                  copyLabel={t('desktopShare.copy')}
                  copiedLabel={t('desktopShare.copied')}
                />
              ) : null}
              {origin ? (
                <CopyField
                  label={t('desktopShare.lanUrl')}
                  value={origin}
                  hint={t('desktopShare.lanHint')}
                  copyLabel={t('desktopShare.copy')}
                  copiedLabel={t('desktopShare.copied')}
                />
              ) : null}
              {pin ? (
                <CopyField
                  label={t('desktopShare.pin')}
                  value={pin}
                  emphasize
                  copyLabel={t('desktopShare.copy')}
                  copiedLabel={t('desktopShare.copied')}
                />
              ) : null}
            </div>
            {qrSvg ? (
              <div
                className={css.qr}
                aria-hidden
                // Host-minted SVG for the share origin (same generator as pairing).
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            ) : null}
          </div>
          <p className={css.hint}>
            {t('desktopShare.tunnelHint', {
              localOrigin: localOrigin || '—',
              sharePort: sharePort !== undefined ? String(sharePort) : '—',
            })}
          </p>
          <p className={css.hint}>{t('desktopShare.firewallHint')}</p>
        </div>
      ) : null}
    </div>
  )
}
