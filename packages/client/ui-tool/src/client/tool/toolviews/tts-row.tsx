// text_to_speech toolview: an inline playback bar for the synthesized clip.
//
// The row owns the <audio> element itself, outside the disclosure body: a
// collapsed ToolRow does not mount its children, and the whole point of this
// card is that a freshly synthesized reply starts speaking without the reader
// clicking anything. The visible bar (play/pause, seek, time, download) is the
// expanded body and simply drives that one element.
//
// Auto-play is deliberately narrow: it fires only for a call this row watched
// arrive (mounted while running → settled), once per `sessionId` + attachment,
// and only the newest clip per session keeps playing. A page that reopens a
// transcript replays nothing, and a browser that refuses play() degrades to a
// one-line hint instead of an error.

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { Context } from '@xrkseek/cordis'
import {
  IconDownloadOutlineRegular, IconMicrophoneOutlineRegular,
  IconPauseOutlineRegular, IconPlayOutlineRegular,
} from '@xrkseek/client-ui-primitives'
import type { PropsLocale } from '@xrkseek/client-ui-slots'
import type { FileAttachmentRef } from '@xrkseek/xrk-attachment'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import {
  formatClipSummary, formatClipTime, ttsCardModel, voiceDisplayName,
} from '../models/tts-card-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'
import css from './tts-row.module.css'

type TtsRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/**
 * Clips that already auto-started in this page lifetime, keyed by
 * `sessionId` + attachment id. Module-level on purpose: collapsing the row,
 * re-rendering the turn, or leaving and re-entering the session all remount
 * the component, and no remount may replay a clip the user already heard.
 */
const autoPlayed = new Set<string>()

/** Last clip auto-playing per session; a newer result stops the previous one. */
const autoPlayers = new Map<string, HTMLAudioElement>()

/** Oldest auto-play keys are evicted past this; the set only suppresses replays. */
const AUTO_PLAYED_CAP = 200

/** Text summary for a call that has not settled yet (its args, not the clip). */
function speakSummary(argsRaw: string): string {
  try {
    const args = JSON.parse(argsRaw) as { text?: unknown }
    if (typeof args.text === 'string' && args.text.trim() !== '') {
      const oneLine = args.text.trim().replace(/\s+/g, ' ')
      return oneLine.length > 48 ? `${oneLine.slice(0, 48)}…` : oneLine
    }
  } catch {
    /* mid-stream args */
  }
  return ''
}

/** Synthesized clips are blob/data URLs: a plain anchor is the whole download. */
function triggerDownload(href: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** One action icon button used by the bar (download). */
function BarAction({
  label, onClick, children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={css.action}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/**
 * The expanded playback bar. It drives the row's single <audio> element; all
 * media state is read from that element so a bar mounted after an auto-play
 * already started reports the live position instead of zero.
 */
function TtsPlayer({
  audioRef, url, filename, duration, onDuration, t,
}: {
  audioRef: RefObject<HTMLAudioElement | null>
  url: string
  filename: string
  duration: number | null
  onDuration: (seconds: number) => void
  t: TtsRowProps['t']
}) {
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [total, setTotal] = useState(duration ?? 0)

  useEffect(() => {
    const element = audioRef.current
    if (element === null) return
    const syncDuration = (): void => {
      if (!Number.isFinite(element.duration) || element.duration <= 0) return
      setTotal(element.duration)
      onDuration(element.duration)
    }
    const syncTime = (): void => { setCurrent(element.currentTime) }
    const syncPlay = (): void => { setPlaying(true) }
    const syncPause = (): void => { setPlaying(false) }
    const syncEnded = (): void => {
      setPlaying(false)
      setCurrent(Number.isFinite(element.duration) ? element.duration : 0)
    }
    element.addEventListener('loadedmetadata', syncDuration)
    element.addEventListener('durationchange', syncDuration)
    element.addEventListener('timeupdate', syncTime)
    element.addEventListener('play', syncPlay)
    element.addEventListener('pause', syncPause)
    element.addEventListener('ended', syncEnded)
    // An auto-play may already have crossed metadata / started before the bar
    // was expanded, so seed the bar from the element once on mount.
    if (element.readyState >= 1) syncDuration()
    setCurrent(element.currentTime)
    setPlaying(!element.paused)
    return () => {
      element.removeEventListener('loadedmetadata', syncDuration)
      element.removeEventListener('durationchange', syncDuration)
      element.removeEventListener('timeupdate', syncTime)
      element.removeEventListener('play', syncPlay)
      element.removeEventListener('pause', syncPause)
      element.removeEventListener('ended', syncEnded)
    }
  }, [audioRef, onDuration])

  const toggle = (): void => {
    const element = audioRef.current
    if (element === null) return
    if (element.paused) {
      try {
        const attempt = element.play()
        if (attempt !== undefined) void attempt.catch(() => { /* user can retry */ })
      } catch {
        /* jsdom / blocked media: the bar stays paused */
      }
      return
    }
    element.pause()
  }

  const seek = (seconds: number): void => {
    const element = audioRef.current
    if (element === null) return
    element.currentTime = seconds
    setCurrent(seconds)
  }

  return (
    <div className={css.player} data-tts-player="">
      <button
        type="button"
        className={css.playButton}
        aria-label={t(playing ? 'tts.pause' : 'tts.play')}
        title={t(playing ? 'tts.pause' : 'tts.play')}
        onClick={toggle}
      >
        {playing
          ? <IconPauseOutlineRegular size={18} />
          : <IconPlayOutlineRegular size={18} />}
      </button>
      <span className={css.time} data-tts-time="current">{formatClipTime(current)}</span>
      <input
        type="range"
        className={css.seek}
        min={0}
        max={total > 0 ? total : 0}
        step={0.1}
        value={Math.min(current, total)}
        disabled={total <= 0}
        aria-label={t('tts.seek')}
        onChange={(event) => { seek(Number(event.currentTarget.value)) }}
      />
      <span className={css.time} data-tts-time="total">{formatClipTime(total)}</span>
      <BarAction
        label={t('tts.download')}
        onClick={() => { triggerDownload(url, filename) }}
      >
        <IconDownloadOutlineRegular size={14} />
      </BarAction>
    </div>
  )
}

/**
 * text_to_speech row: a one-line summary (voice · duration) plus the clip's
 * playback bar when the Host stored the audio, or an honest "not playable"
 * line when it only returned the truncated base64 preview.
 */
export function TtsRow({
  toolName, block, cwd, home, loadAttachment, sessionId, t,
}: TtsRowProps) {
  const model = toolRowModel(toolName, block, cwd, home)
  const tts = ttsCardModel(block)
  const argsRaw = ('kind' in block ? block.call?.argsRaw : block.argsRaw) ?? ''
  // A row that mounts already settled is history replay; only a call that was
  // still running on first mount is a live arrival worth speaking.
  const [liveArrival] = useState(() => !('kind' in block))
  const attachment = tts?.attachment ?? null
  const attachmentId = attachment?.attachmentId ?? null
  const audioRef = useRef<HTMLAudioElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  // Diagnostic: keep the real rejection text on screen instead of a generic
  // line, so a failed clip names its own cause (unknown session / RPC code).
  const [failed, setFailed] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [blocked, setBlocked] = useState(false)
  // A blob that fails to decode never fires `load`; without this the bar looks
  // playable and pressing play does nothing at all.
  const [mediaBroken, setMediaBroken] = useState(false)

  // The attachment object is rebuilt by every model pass, so the id is the
  // only real identity: reloading on object identity would loop.
  const attachmentRef = useRef<FileAttachmentRef | null>(attachment)
  attachmentRef.current = attachment
  useEffect(() => {
    const ref = attachmentRef.current
    if (attachmentId === null || loadAttachment === undefined || ref === null) return
    let alive = true
    void loadAttachment(ref).then(
      (next) => { if (alive) setUrl(next) },
      (error: unknown) => {
        if (alive) setFailed(error instanceof Error ? error.message : String(error))
      },
    )
    return () => { alive = false }
  }, [attachmentId, loadAttachment])

  // Auto-play: one live clip per row, once per session+attachment, newest wins.
  const autoKey = attachmentId === null ? null : `${sessionId}\u0000${attachmentId}`
  useEffect(() => {
    const element = audioRef.current
    if (element === null || url === null || autoKey === null || !liveArrival) return
    if (autoPlayed.has(autoKey)) return
    autoPlayed.add(autoKey)
    if (autoPlayed.size > AUTO_PLAYED_CAP) {
      const oldest = autoPlayed.values().next().value
      if (oldest !== undefined) autoPlayed.delete(oldest)
    }
    const previous = autoPlayers.get(sessionId)
    if (previous !== undefined && previous !== element) previous.pause()
    autoPlayers.set(sessionId, element)
    try {
      const attempt = element.play()
      // A browser that refuses gesture-less play() decides that for us: show
      // the hint, never an error dialog.
      if (attempt !== undefined) void attempt.catch(() => { setBlocked(true) })
    } catch {
      setBlocked(true)
    }
  }, [url, autoKey, liveArrival, sessionId])

  // A row that unmounts must stop being the session's "current player": the
  // map holds a live <audio> (and its blob URL), and a long transcript would
  // otherwise pin one element per session for the life of the page.
  useEffect(() => {
    const element = audioRef.current
    return () => {
      if (element !== null && autoPlayers.get(sessionId) === element) {
        autoPlayers.delete(sessionId)
      }
    }
  }, [sessionId])

  const onDuration = useCallback((seconds: number) => { setDuration(seconds) }, [])

  const voice = voiceDisplayName(tts?.voice ?? null)
  const settledState = model.state
  const summary = settledState === 'error' && model.errorSummary
    ? model.errorSummary
    : settledState === 'running'
      ? [t('tts.synthesizing'), speakSummary(argsRaw)].filter(Boolean).join(' · ')
      : [
        voice,
        duration !== null ? formatClipSummary(duration) : null,
        attachment === null && (tts?.truncated ?? false) ? t('tts.unavailableShort') : null,
      ].filter((part): part is string => part !== null && part !== '').join(' · ')

  const filename = attachment?.name ?? 'tts.mp3'
  const body = (() => {
    // Running / stopped / failed calls have no clip surface: the collapsed
    // summary already carries the state, and ToolRow renders the failure line.
    if (settledState !== 'ok') return null
    if (attachment === null) {
      return (
        <div className={css.notice} role="status" data-tts-fallback="">
          {t(tts?.truncated ?? false ? 'tts.unavailable' : 'tts.empty')}
        </div>
      )
    }
    if (failed !== null) {
      return (
        <div className={css.notice} role="status">
          {t('tts.loadFailed')} · {failed}
        </div>
      )
    }
    if (mediaBroken) {
      return <div className={css.notice} role="status">{t('tts.unavailable')}</div>
    }
    if (url === null) {
      return <div className={css.notice} role="status">{t('tts.loading')}</div>
    }
    return (
      <div className={css.body}>
        <TtsPlayer
          audioRef={audioRef}
          url={url}
          filename={filename}
          duration={duration}
          onDuration={onDuration}
          t={t}
        />
        {blocked && <div className={css.hint}>{t('tts.autoplayBlocked')}</div>}
        {tts !== null && tts.meta !== '' && <div className={css.meta}>{tts.meta}</div>}
      </div>
    )
  })()

  return (
    <div className={css.root}>
      {/*
        The media element lives outside the disclosure body: a collapsed
        ToolRow unmounts its children, and auto-play must not depend on the
        reader having opened the row. `preload="metadata"` is enough to fill
        the duration into the collapsed summary.
      */}
      <audio
        ref={audioRef}
        className={css.audio}
        src={url ?? undefined}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const seconds = event.currentTarget.duration
          if (Number.isFinite(seconds) && seconds > 0) setDuration(seconds)
        }}
        onError={() => { setMediaBroken(true) }}
      />
      <ToolRow
        t={t}
        variant="others"
        toolName={toolName}
        icon={<IconMicrophoneOutlineRegular size={14} />}
        title={t('tool.name.textToSpeech')}
        summary={summary}
        body={null}
        // The bar owns the result surface; never dump the envelope / base64 as OUT.
        output={null}
        bodyContent={body}
        // A spoken clip is the deliverable, not an exploration step: keep the
        // player visible instead of hiding it behind the disclosure chevron.
        forceExpanded
        errorSummary={model.errorSummary}
        state={model.state}
      />
    </div>
  )
}

/** The text_to_speech row as a plain registrant plugin. */
export const ttsToolview = {
  name: 'tts-toolview',
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'text_to_speech',
        locale: NS,
      }, TtsRow))
  },
}
