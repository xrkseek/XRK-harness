/** General Settings row: chat tool rows start expanded when enabled. */
import type { SnapshotStore } from '@xrkseek/client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import css from './EnterBehaviorRow.module.css'

/** Registration-side preference face. */
export interface ToolsExpandRowInjected {
  hooks: {
    /** Persisted expand preference bound as useToolsDefaultExpanded. */
    toolsDefaultExpanded: SnapshotStore<boolean>
  }
  /** Persist the expand preference. */
  setToolsDefaultExpanded: (expanded: boolean) => void
}

/** Full Settings-row props. */
export type ToolsExpandRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<ToolsExpandRowInjected>

/**
 * Render the auto-expand-tools switch (chat ToolRow / Bash initial open).
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function ToolsExpandRow({
  useToolsDefaultExpanded,
  setToolsDefaultExpanded,
  t,
}: ToolsExpandRowProps) {
  const expanded = useToolsDefaultExpanded(value => value)

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.toolsExpand.title')}</div>
        <div className={css.desc}>{t('settings.toolsExpand.description')}</div>
      </div>
      <button
        type="button"
        className={css.switch}
        role="switch"
        aria-checked={expanded}
        aria-label={t('settings.toolsExpand.title')}
        onClick={() => { setToolsDefaultExpanded(!expanded) }}
      >
        <span className={css.track} data-on={expanded || undefined} aria-hidden="true">
          <span className={css.thumb} />
        </span>
      </button>
    </div>
  )
}
