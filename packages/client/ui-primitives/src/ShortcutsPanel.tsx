/**
 * Global keyboard-shortcuts panel (Hermes keybinds.openPanel / Codex footer
 * Shortcuts overlay subset). Cordis-free: owner supplies entries + labels.
 * Optional customize/reset (Hermes/DSH): click chord → capture; per-row reset
 * + footer reset-all when editable.
 */

import type { ReactNode } from 'react'
import { Modal } from './Modal.tsx'
import css from './ShortcutsPanel.module.css'

export interface ShortcutEntry {
  readonly id: string
  readonly keys: string
  readonly label: string
  readonly category?: string
  /** Display-only — chord not clickable for rebind. */
  readonly fixed?: boolean
  /** True when the effective binding differs from the shipped default. */
  readonly customized?: boolean
}

export interface ShortcutsPanelProps {
  open: boolean
  onClose: () => void
  title: string
  closeLabel: string
  description?: string
  searchPlaceholder?: string
  entries: readonly ShortcutEntry[]
  /** Optional filter text (controlled by owner when search is enabled). */
  filter?: string
  onFilterChange?: (value: string) => void
  emptyLabel?: string
  /** When set, editable rows can be rebound / reset (Hermes/DSH). */
  editable?: boolean
  /** Action id currently listening for a chord, or null. */
  capturingId?: string | null
  onStartCapture?: (id: string) => void
  onCancelCapture?: () => void
  onReset?: (id: string) => void
  onResetAll?: () => void
  resetLabel?: string
  resetAllLabel?: string
  pressKeyLabel?: string
  rebindLabel?: string
  /** Soft conflict / blocked-save hint under the search field. */
  conflictHint?: string | null
}

/**
 * Modal listing chord → action rows, optionally filterable and editable.
 */
export function ShortcutsPanel({
  open,
  onClose,
  title,
  closeLabel,
  description,
  searchPlaceholder = 'Search',
  entries,
  filter = '',
  onFilterChange,
  emptyLabel = 'No shortcuts',
  editable = false,
  capturingId = null,
  onStartCapture,
  onCancelCapture,
  onReset,
  onResetAll,
  resetLabel = 'Restore default',
  resetAllLabel = 'Restore all defaults',
  pressKeyLabel = 'Press a key…',
  rebindLabel = 'Click to rebind',
  conflictHint = null,
}: ShortcutsPanelProps): ReactNode {
  const q = filter.trim().toLowerCase()
  const visible = q.length === 0
    ? entries
    : entries.filter((e) =>
      e.label.toLowerCase().includes(q)
      || e.keys.toLowerCase().includes(q)
      || (e.category?.toLowerCase().includes(q) ?? false)
      || e.id.toLowerCase().includes(q))

  const byCategory = new Map<string, ShortcutEntry[]>()
  for (const entry of visible) {
    const cat = entry.category ?? ''
    const list = byCategory.get(cat) ?? []
    list.push(entry)
    byCategory.set(cat, list)
  }

  const anyCustomized = entries.some((e) => e.customized === true)

  const footer = editable && onResetAll !== undefined
    ? (
      <button
        type="button"
        className={css.resetAll}
        disabled={!anyCustomized}
        onClick={() => { onResetAll() }}
      >
        {resetAllLabel}
      </button>
    )
    : undefined

  return (
    <Modal
      open={open}
      onClose={() => {
        if (capturingId !== null) onCancelCapture?.()
        onClose()
      }}
      title={title}
      closeLabel={closeLabel}
      {...(description !== undefined ? { description } : {})}
      {...(css.content !== undefined ? { contentClassName: css.content } : {})}
      {...(footer !== undefined ? { footer } : {})}
    >
      {onFilterChange !== undefined ? (
        <input
          type="search"
          className={css.search}
          value={filter}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          onChange={(e) => { onFilterChange(e.currentTarget.value) }}
        />
      ) : null}
      {conflictHint !== null && conflictHint !== '' ? (
        <p className={css.conflict} role="status">{conflictHint}</p>
      ) : null}
      {visible.length === 0 ? (
        <p className={css.empty}>{emptyLabel}</p>
      ) : (
        <div className={css.list}>
          {[...byCategory.entries()].map(([cat, rows]) => (
            <section key={cat || '_'} className={css.group}>
              {cat !== '' ? <h3 className={css.groupTitle}>{cat}</h3> : null}
              <ul className={css.rows}>
                {rows.map((row) => {
                  const capturing = capturingId === row.id
                  const canEdit = editable && row.fixed !== true && onStartCapture !== undefined
                  return (
                    <li key={row.id} className={css.row}>
                      <span className={css.label}>{row.label}</span>
                      <span className={css.actions}>
                        {canEdit ? (
                          <button
                            type="button"
                            className={capturing ? css.keysCapturing : css.keysButton}
                            aria-label={rebindLabel}
                            title={rebindLabel}
                            onClick={() => {
                              if (capturing) onCancelCapture?.()
                              else onStartCapture(row.id)
                            }}
                          >
                            {capturing ? pressKeyLabel : row.keys}
                          </button>
                        ) : (
                          <kbd className={css.keys}>{row.keys}</kbd>
                        )}
                        {canEdit && row.customized === true && onReset !== undefined ? (
                          <button
                            type="button"
                            className={css.resetOne}
                            aria-label={resetLabel}
                            title={resetLabel}
                            onClick={() => { onReset(row.id) }}
                          >
                            ↺
                          </button>
                        ) : (
                          <span className={css.resetSpacer} aria-hidden />
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Modal>
  )
}
