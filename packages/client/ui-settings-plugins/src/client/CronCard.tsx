/** Host cron master switch card (Face `cron.enabled`). */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { SelectField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
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
  const disabled = !state.writable
  const enabled = state.enabled.text === 'false' ? 'false' : 'true'
  return (
    <PluginCard
      t={t}
      titleKey="cronTitle"
      descriptionKey="cronDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SelectField
        id="plugin-config-cron-enabled"
        label={t('cronEnabled')}
        hint={t('cronEnabledHint')}
        disabled={disabled}
        value={enabled}
        options={[
          { value: 'true', label: t('cronEnabledOn') },
          { value: 'false', label: t('cronEnabledOff') },
        ]}
        onChange={(value) => { props.edit('enabled', value) }}
      />
      <p className={css.note} role="note">{t('cronLiveHint')}</p>
      <p className={css.note} role="note">{t('cronScheduleNote')}</p>
    </PluginCard>
  )
}
