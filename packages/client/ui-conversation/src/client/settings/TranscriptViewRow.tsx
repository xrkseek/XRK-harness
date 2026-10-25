/** General Settings row for work-details presentation. */
import { useState } from 'react'
import type { SnapshotStore } from '@xrkseek/client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { IconChevronDownOutlineRegular, Menu } from '@xrkseek/client-ui-primitives'
import { TRANSCRIPT_VIEW_MODES, type TranscriptViewMode } from '../../submission-settings.ts'
import type { ConversationKey } from '../locales.ts'
import css from './EnterBehaviorRow.module.css'

/** Registration-side work-details preference face. */
export interface TranscriptViewRowInjected {
  hooks: {
    /** Persisted work-details mode bound as useTranscriptView. */
    readonly transcriptView: SnapshotStore<TranscriptViewMode>
  }
  /** Change how much of a settled Turn's process run stays visible. */
  setTranscriptView: (mode: TranscriptViewMode) => void
}

/** Full Settings-row props. */
export type TranscriptViewRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<TranscriptViewRowInjected>

const LABELS = {
  compact: 'settings.transcriptView.compact',
  standard: 'settings.transcriptView.standard',
  detailed: 'settings.transcriptView.detailed',
  verbose: 'settings.transcriptView.verbose',
} as const satisfies Record<TranscriptViewMode, ConversationKey>

/**
 * Render the work-details selector.
 *
 * Four points on one axis, quietest first: a completed Turn's process run
 * either folds or does not, and the rows are either grouped or not. `verbose`
 * is the "always expanded" posture — see `presentationPolicyFor`.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function TranscriptViewRow({ useTranscriptView, setTranscriptView, t }: TranscriptViewRowProps) {
  const mode = useTranscriptView(value => value)
  const [open, setOpen] = useState(false)

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.transcriptView.title')}</div>
        <div className={css.desc}>{t('settings.transcriptView.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={TRANSCRIPT_VIEW_MODES.map(id => ({ id, label: t(LABELS[id]) }))}
        selectedId={mode}
        onSelect={(id) => {
          setOpen(false)
          setTranscriptView(id as TranscriptViewMode)
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            {t(LABELS[mode])}
            <IconChevronDownOutlineRegular className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
