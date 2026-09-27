/**
 * The read-only lines of an information card.
 *
 * A row's value is either text the Host published (an address, a path, a
 * count) or one of a closed set this package's copy owns (the IM gateway mode,
 * whether the Web bundle is Host-served), so a row carries whichever it has as
 * {@link InfoRow.value} or {@link InfoRow.valueKey}. The label is always a key:
 * what a fact is called is the section's copy, never the Host's.
 */

import type { PluginsSettingsLocaleKey } from './locales.ts'
import type { InfoRow } from './info-card-model.ts'
import css from './InfoRows.module.css'

/** Props of the read-only line list. */
export interface InfoRowsProps {
  /** Locale reader for this section's copy. */
  t: (key: PluginsSettingsLocaleKey) => string
  /** Lines to render, in reading order. */
  rows: readonly InfoRow[]
}

/**
 * Render a card's read-only lines.
 * @param props - the locale reader and the lines.
 * @returns a description list, one label/value pair per row.
 */
export function InfoRows(props: InfoRowsProps) {
  return (
    <dl className={css.rows}>
      {props.rows.map(row => (
        <div key={row.label} className={css.row}>
          <dt className={css.label}>{props.t(row.label)}</dt>
          <dd className={css.value}>
            {row.valueKey === undefined ? row.value : props.t(row.valueKey)}
          </dd>
        </div>
      ))}
    </dl>
  )
}
