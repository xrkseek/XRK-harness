/**
 * The local-engine block inside the ASR card.
 *
 * It answers the three questions a first-time user has, in the order they ask
 * them: *can this device do it at all*, *what is missing*, and *what do I press*.
 * Everything shown comes from the Host (`voice.inspect` / `voice.prepareStatus`)
 * — the card never guesses readiness from a filename.
 *
 * Failure copy is per-code rather than one generic line: "网络中断，换镜像重试"
 * is a next step, "download failed" is a dead end. The Host's own reason string
 * is shown verbatim beside it, because it names the thing to fix.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { dictationAvailable, startVoiceCapture, type VoiceCapture } from '@xrkseek/exec-voice/capture'
import type { AsrCardFace, VoiceLocalState } from './asr-card-controller.ts'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import css from './VoiceLocalBlock.module.css'

/** Below this a press was a mis-click, not speech. */
const MIN_TRIAL_MS = 300

type TrialPhase = 'idle' | 'recording' | 'working'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value).toString()} ${units[unit]}`
}

/** One "what do I do now" line per failure code (the Host's message rides beside it). */
const FAILURE_HINT: Record<string, PluginsSettingsLocaleKey> = {
  network: 'voiceLocalFailNetwork',
  timeout: 'voiceLocalFailTimeout',
  http: 'voiceLocalFailHttp',
  integrity: 'voiceLocalFailIntegrity',
  storage: 'voiceLocalFailStorage',
  cancelled: 'voiceLocalFailCancelled',
  unknown: 'voiceLocalFailUnknown',
}

export interface VoiceLocalBlockProps {
  readonly local: VoiceLocalState
  /** Read-only scope (the whole card refuses writes). */
  readonly disabled: boolean
  readonly refreshLocal: AsrCardFace['refreshLocal']
  readonly prepareLocal: AsrCardFace['prepareLocal']
  readonly cancelLocal: AsrCardFace['cancelLocal']
  readonly transcribeLocal: AsrCardFace['transcribeLocal']
  readonly t: (key: PluginsSettingsLocaleKey) => string
}

export function VoiceLocalBlock({
  local, disabled, refreshLocal, prepareLocal, cancelLocal, transcribeLocal, t,
}: VoiceLocalBlockProps) {
  const [trial, setTrial] = useState<TrialPhase>('idle')
  const [trialText, setTrialText] = useState<string | undefined>(undefined)
  const [trialError, setTrialError] = useState<string | undefined>(undefined)
  const captureRef = useRef<VoiceCapture | null>(null)
  const mountedRef = useRef(true)
  // The trial records in *this* browser, so it needs the same gate as the
  // composer seat: a device without capture can still prepare the Host's
  // weights, it just cannot record a sample here.
  const canTrial = dictationAvailable()

  useEffect(() => () => {
    mountedRef.current = false
    captureRef.current?.cancel()
    captureRef.current = null
  }, [])

  const fail = (error: unknown): void => {
    if (!mountedRef.current) return
    setTrialError(error instanceof Error ? error.message : String(error))
    setTrial('idle')
  }

  const beginTrial = async (): Promise<void> => {
    setTrialError(undefined)
    setTrialText(undefined)
    let capture: VoiceCapture
    try {
      capture = await startVoiceCapture()
    } catch (error: unknown) {
      fail(error)
      return
    }
    if (!mountedRef.current) {
      capture.cancel()
      return
    }
    captureRef.current = capture
    setTrial('recording')
  }

  const finishTrial = async (): Promise<void> => {
    const capture = captureRef.current
    if (capture === null) return
    captureRef.current = null
    setTrial('working')
    try {
      const clip = await capture.stop()
      if (!mountedRef.current) return
      if (clip.durationMs < MIN_TRIAL_MS) {
        setTrialText(t('voiceLocalTrialEmpty'))
        setTrial('idle')
        return
      }
      const text = (await transcribeLocal(clip.audio, clip.mimeType)).trim()
      if (!mountedRef.current) return
      setTrialText(text === '' ? t('voiceLocalTrialEmpty') : text)
      setTrial('idle')
    } catch (error: unknown) {
      fail(error)
    }
  }

  const inspect = local.inspect
  // No voice Remote on this Host: there is nothing to probe, and offering a
  // 「recheck」 link would promise a request that can never be answered.
  if (!local.readable) {
    return <p className={css.intro}>{t('voiceLocalRemoteMissing')}</p>
  }
  if (local.loading) {
    return <p className={css.intro}>{t('voiceLocalChecking')}</p>
  }
  if (inspect === undefined) {
    return (
      <div className={css.block}>
        <p className={css.error}>{t('voiceLocalUnreadable')}</p>
        <div className={css.actions}>
          <button type="button" className={css.action} onClick={refreshLocal}>
            {t('voiceLocalRefresh')}
          </button>
        </div>
      </div>
    )
  }

  // The platform can never run the native binding: say so once, point at cloud.
  if (!inspect.engine.supported) {
    return (
      <div className={css.block}>
        <p className={css.head}>
          <span className={clsx(css.dot, css.dotBusy)} aria-hidden />
          {t('voiceLocalUnavailable')}
        </p>
        {inspect.engine.reason === undefined
          ? null
          : <p className={css.intro}>{inspect.engine.reason}</p>}
        <p className={css.intro}>{t('voiceLocalUnavailableHint')}</p>
      </div>
    )
  }

  const prepare = inspect.prepare
  if (prepare.phase === 'preparing') {
    const percent = prepare.bytesTotal === 0
      ? 0
      : Math.min(100, (prepare.bytesDone / prepare.bytesTotal) * 100)
    return (
      <div className={css.block}>
        <p className={css.head}>
          <span className={clsx(css.dot, css.dotBusy)} aria-hidden />
          {t('voiceLocalDownloading')}
        </p>
        <div
          className={css.progressTrack}
          role="progressbar"
          aria-label={t('voiceLocalDownloading')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
        >
          <div className={css.progressFill} style={{ width: `${percent}%` }} />
        </div>
        <div className={css.progressMeta}>
          {/* Zero bytes with zero speed is the header wait, not a stalled
              transfer: say 「connecting」 instead of a progress line that
              never moves (the reported 「always 0 B」 freeze). */}
          <span>
            {prepare.bytesDone === 0 && prepare.speedBps === 0
              ? t('voiceLocalConnecting')
              : `${formatBytes(prepare.bytesDone)} / ${formatBytes(prepare.bytesTotal)}`}
          </span>
          <span>
            {prepare.speedBps > 0
              ? `${formatBytes(prepare.speedBps)}${t('voiceLocalPerSecond')}`
              : '—'}
          </span>
        </div>
        <div className={css.actions}>
          <button
            type="button"
            className={css.action}
            disabled={disabled}
            onClick={cancelLocal}
          >
            {t('voiceLocalCancel')}
          </button>
        </div>
      </div>
    )
  }

  if (prepare.phase === 'failed' && prepare.failure !== null) {
    const hintKey = FAILURE_HINT[prepare.failure.code] ?? 'voiceLocalFailUnknown'
    return (
      <div className={css.block}>
        <p className={css.error}>{prepare.failure.message}</p>
        <p className={css.intro}>{t(hintKey)}</p>
        <div className={css.actions}>
          <button
            type="button"
            className={clsx(css.action, css.primary)}
            disabled={disabled}
            onClick={prepareLocal}
          >
            {t('voiceLocalRetry')}
          </button>
          <button type="button" className={css.action} onClick={refreshLocal}>
            {t('voiceLocalRefresh')}
          </button>
        </div>
      </div>
    )
  }

  // Weights present, binding absent: the fix is a Host-side install, and the
  // card says the exact command instead of implying the download would help.
  if (inspect.assets.ready && !inspect.engine.engine) {
    return (
      <div className={css.block}>
        <p className={css.head}>
          <span className={clsx(css.dot, css.dotBusy)} aria-hidden />
          {t('voiceLocalEngineMissing')}
        </p>
        {inspect.engine.reason === undefined
          ? null
          : <p className={css.intro}>{inspect.engine.reason}</p>}
        <p className={css.quote}>{t('voiceLocalEngineMissingHint')}</p>
        <div className={css.actions}>
          <button type="button" className={css.action} onClick={refreshLocal}>
            {t('voiceLocalRefresh')}
          </button>
        </div>
      </div>
    )
  }

  if (inspect.ready) {
    return (
      <div className={css.block}>
        <p className={css.head}>
          <span className={clsx(css.dot, css.dotReady)} aria-hidden />
          {t('voiceLocalReady')}
        </p>
        <p className={css.path}>{inspect.dataRoot}</p>
        {trialText === undefined ? null : <p className={css.quote}>{trialText}</p>}
        {trialError === undefined ? null : <p className={css.error}>{trialError}</p>}
        {canTrial ? null : <p className={css.intro}>{t('voiceLocalTrialUnsupported')}</p>}
        <div className={css.actions}>
          <button
            type="button"
            className={clsx(css.action, css.primary)}
            disabled={disabled || trial === 'working' || !canTrial}
            onClick={() => {
              if (trial === 'recording') void finishTrial()
              else void beginTrial()
            }}
          >
            {trial === 'recording'
              ? t('voiceLocalTrialRecording')
              : trial === 'working'
                ? t('voiceLocalTrialWorking')
                : t('voiceLocalTrial')}
          </button>
          <button
            type="button"
            className={css.action}
            disabled={trial !== 'idle'}
            onClick={refreshLocal}
          >
            {t('voiceLocalRefresh')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={css.block}>
      <p className={css.head}>
        <span className={clsx(css.dot, css.dotBusy)} aria-hidden />
        {t('voiceLocalNeedFiles')}
      </p>
      <ul className={css.files}>
        {inspect.assets.missing.map(name => (
          <li key={name} className={css.fileRow}>
            <span className={css.fileName}>{name}</span>
            <span className={css.fileState}>{t('voiceLocalMissingState')}</span>
          </li>
        ))}
      </ul>
      {/* The transfer is not the whole story: without the native binding the
          weights cannot run, so this is said before a 230 MB download rather
          than after it. */}
      {inspect.engine.engine
        ? null
        : <p className={css.intro}>{t('voiceLocalEngineMissingInline')}</p>}
      <p className={css.path}>{t('voiceLocalTarget')} {inspect.dataRoot}</p>
      <div className={css.actions}>
        <button
          type="button"
          className={clsx(css.action, css.primary)}
          disabled={disabled}
          onClick={prepareLocal}
        >
          {t('voiceLocalDownload')} · {formatBytes(inspect.assets.totalBytes)}
        </button>
        <button type="button" className={css.action} onClick={refreshLocal}>
          {t('voiceLocalRefresh')}
        </button>
      </div>
    </div>
  )
}
