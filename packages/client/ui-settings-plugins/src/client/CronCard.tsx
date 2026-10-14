/** Host cron master switch card (Face `cron.enabled`). */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { PluginCard } from './PluginCard.tsx'
import { booleanMasterSwitch } from './plugin-master-switch.ts'
import type { CronCardFace } from './cron-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

/** Props the renderer binds for the cron card. */
export type CronCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<CronCardFace>

/**
 * Render the Host cron master-switch card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function CronCard(props: CronCardProps) {
  const { t } = props
  const state = props.useCronCard(snapshot => snapshot)
  const enabled = state.enabled.text !== 'false'
  return (
    <PluginCard
      t={t}
      titleKey="cronTitle"
      descriptionKey="cronDescription"
      state={state}
      masterSwitch={booleanMasterSwitch(enabled, (value) => { props.edit('enabled', value) })}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <p className={css.note} role="note">{t('cronEnabledHint')}</p>
      <p className={css.note} role="note">{t('cronLiveHint')}</p>
      <p className={css.note} role="note">{t('cronScheduleNote')}</p>
    </PluginCard>
  )
}
