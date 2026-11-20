/** The General section: one column rendering feature-owned item contributions. */
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@xrkseek/client-ui-slots'
import css from './GeneralSection.module.css'

/** Full component props: section owner share plus item render share. */
export type GeneralSectionComponentProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings'>
  & PropsRenderSlots<'settings.general.item'>

/**
 * Render the General section content column.
 * Shell nav already titles the page — skip a second heading (same as Plugins home).
 * @param props - composed slot props (contract/slots.ts).
 * @returns the section element tree.
 */
export function GeneralSection({ t, renderSlot }: GeneralSectionComponentProps) {
  return (
    <div className={css.section}>
      <p className={css.intro}>{t('general.intro')}</p>
      <div className={css.stack}>
        {renderSlot('settings.general.item', {})}
      </div>
    </div>
  )
}
