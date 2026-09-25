/**
 * Global keyboard-shortcuts panel (Hermes keybinds.openPanel / Codex footer
 * Shortcuts overlay subset). Cordis-free: owner supplies entries + labels.
 */

import type { ReactNode } from 'react'
import { Modal } from './Modal.tsx'
import css from './ShortcutsPanel.module.css'

export interface ShortcutEntry {
  readonly id: string
  readonly keys: string
  readonly label: string
  readonly category?: string
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
}

/**
 * Modal listing chord → action rows, optionally filterable.
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      closeLabel={closeLabel}
      {...(description !== undefined ? { description } : {})}
      contentClassName={css.content}
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
      {visible.length === 0 ? (
        <p className={css.empty}>{emptyLabel}</p>
      ) : (
        <div className={css.list}>
          {[...byCategory.entries()].map(([cat, rows]) => (
            <section key={cat || '_'} className={css.group}>
              {cat !== '' ? <h3 className={css.groupTitle}>{cat}</h3> : null}
              <ul className={css.rows}>
                {rows.map((row) => (
                  <li key={row.id} className={css.row}>
                    <span className={css.label}>{row.label}</span>
                    <kbd className={css.keys}>{row.keys}</kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Modal>
  )
}
