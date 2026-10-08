/**
 * Sidebar-foot release-notes button: a label + bell that carries a red dot
 * while the newest bundled version is unread. Opening the dialog lists every
 * published version as an accordion; expanding the newest entry marks notes
 * read (clears the dot). Older rows stay collapsible for reading without
 * changing the marker.
 *
 * The button follows the sidebar's own trigger geometry (SidebarRoot.module.css
 * `.footerActions`): wide is the labelled row, collapsed is the 36px rail icon.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { SnapshotStore } from '@xrkseek/client-runtime/client'
import type { InjectFace, PropsRuntime } from '@xrkseek/client-ui-slots'
import type { LocalizedText } from '@xrkseek/client-locale/client'
import {
  Button, IconBellOutline16, IconChevronDownOutline14, Modal,
} from '@xrkseek/client-ui-primitives'
import type { ReleaseNotesState, ReleaseNotesStore } from './release-notes-store.ts'
import type { ReleaseNotesKey } from './locales.ts'
import {
  latestReleaseVersion, RELEASE_NOTES, RELEASE_NOTES_PINNED,
} from './release-notes.ts'
import css from './ReleaseNotesButton.module.css'

/** Registration-side dependencies of {@link ReleaseNotesButton}. */
export interface ReleaseNotesButtonInjected {
  hooks: {
    /** Durable or process-local read-marker state (InjectFace derives `useReleaseNotes`). */
    releaseNotes: SnapshotStore<ReleaseNotesState>
  }
  /** Read-marker controller. */
  controller: ReleaseNotesStore
  /** Release-notes copy. */
  t: (key: ReleaseNotesKey) => string
  /** Resolve bundled note copy for the active locale (locale face). */
  resolveText: (text: LocalizedText) => string
}

/** Sidebar owner state plus this button's injected face. */
export type ReleaseNotesButtonProps =
  PropsRuntime<'sidebar.footer.action'> & InjectFace<ReleaseNotesButtonInjected>

/**
 * Render the sidebar-foot release-notes row.
 * @param props - sidebar owner state (wide / rail) and release-notes dependencies.
 * @returns the button row, its unread dot, and the notes dialog.
 */
export function ReleaseNotesButton({
  wide, useReleaseNotes, controller, t, resolveText,
}: ReleaseNotesButtonProps): ReactNode {
  const state = useReleaseNotes(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  /** Which version accordion is open; pinned stays always visible. */
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  const reveal = (): void => {
    setOpen(true)
    // Read only when the user expands a version row — opening the list alone
    // must not clear the unread dot (otherwise every version looks "read").
    setExpanded(null)
  }

  const toggleVersion = (version: string): void => {
    setExpanded((current) => {
      const next = current === version ? null : version
      // Marker tracks the newest bundled id; expanding that row is the read gesture.
      if (next === latestReleaseVersion() && state.unread) void controller.markRead()
      return next
    })
  }

  return (
    <>
      <button
        type="button"
        className={wide ? css.trigger : `${css.trigger} ${css.rail}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={state.unread ? `${t('button')} — ${t('unreadBadge')}` : t('button')}
        onClick={reveal}
      >
        <span className={css.dot} data-unread={state.unread} aria-hidden />
        <IconBellOutline16 className={css.bell} size={wide ? 16 : 18} />
        {wide && <span className={css.label}>{t('button')}</span>}
      </button>

      <Modal
        open={open}
        onClose={() => { setOpen(false); setExpanded(null) }}
        title={t('dialogTitle')}
        closeLabel={t('close')}
        className={css.dialogWide ?? ''}
        contentClassName={css.dialogBody ?? ''}
        footer={<Button variant="outline" autoFocus onClick={() => { setOpen(false); setExpanded(null) }}>{t('close')}</Button>}
      >
        {RELEASE_NOTES_PINNED === null && RELEASE_NOTES.length === 0
          ? <p className={css.empty}>{t('empty')}</p>
          : (
            <>
              {RELEASE_NOTES_PINNED === null ? null : (
                <section className={`${css.entry} ${css.pinned}`}>
                  <header className={css.entryHead}>
                    <span className={css.pinnedBadge}>{t('pinnedBadge')}</span>
                  </header>
                  <h3 className={css.entryTitle}>{resolveText(RELEASE_NOTES_PINNED.title)}</h3>
                  <ul className={css.changes}>
                    {RELEASE_NOTES_PINNED.changes.map((change, index) => (
                      <li key={`pinned-${index}`}>{resolveText(change)}</li>
                    ))}
                  </ul>
                </section>
              )}
              {RELEASE_NOTES.map((note) => {
                const isOpen = expanded === note.version
                const isNewest = note.version === latestReleaseVersion()
                const showUnread = isNewest && state.unread
                return (
                  <section
                    key={note.version}
                    className={isOpen ? `${css.entry} ${css.entryOpen}` : css.entry}
                  >
                    <button
                      type="button"
                      className={css.entryToggle}
                      aria-expanded={isOpen}
                      onClick={() => { toggleVersion(note.version) }}
                    >
                      <span className={css.entryHead}>
                        <span className={css.versionRow}>
                          <span className={css.version}>{note.version}</span>
                          {showUnread
                            ? <span className={css.unreadChip}>{t('unreadChip')}</span>
                            : null}
                        </span>
                        <time className={css.date} dateTime={note.date}>{note.date}</time>
                      </span>
                      <span className={css.entrySummary}>
                        <h3 className={css.entryTitle}>{resolveText(note.title)}</h3>
                        <IconChevronDownOutline14
                          className={isOpen ? `${css.chevron} ${css.chevronOpen}` : css.chevron}
                          size={14}
                        />
                      </span>
                    </button>
                    {isOpen ? (
                      <ul className={css.changes}>
                        {note.changes.map((change, index) => (
                          <li key={`${note.version}-${index}`}>{resolveText(change)}</li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                )
              })}
            </>
          )}
        {state.error === null ? null : <p className={css.error} role="alert">{t('markFailed')}</p>}
      </Modal>
    </>
  )
}
