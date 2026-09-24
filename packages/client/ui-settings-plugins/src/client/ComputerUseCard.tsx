/** Desktop computer-use card (Face `computer-use`: off / UIA / background + helper). */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { SecretField, SelectField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { ComputerUseCardFace } from './computer-use-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

/** Props the renderer binds for the computer-use card. */
export type ComputerUseCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<ComputerUseCardFace>

/**
 * Render the computer-use card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function ComputerUseCard(props: ComputerUseCardProps) {
  const { t } = props
  const state = props.useComputerUseCard(snapshot => snapshot)
  const disabled = !state.writable
  const mode = state.mode.text || 'off'
  const showHelper = mode === 'background'
  return (
    <PluginCard
      t={t}
      titleKey="computerUseTitle"
      descriptionKey="computerUseDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SelectField
        id="plugin-config-computer-use-mode"
        label={t('computerUseMode')}
        hint={t('computerUseModeHint')}
        disabled={disabled}
        value={mode}
        options={[
          { value: 'off', label: t('computerUseModeOff') },
          { value: 'uia', label: t('computerUseModeUia') },
          { value: 'background', label: t('computerUseModeBackground') },
        ]}
        onChange={(value) => { props.edit('mode', value) }}
      />
      {showHelper
        ? (
          <SecretField
            id="plugin-config-computer-use-helper"
            label={t('computerUseHelper')}
            hint={t('computerUseHelperHint')}
            disabled={!state.backgroundWritable}
            text={state.backgroundHelper.text}
            configured={state.backgroundConfigured}
            stateLabel={state.backgroundConfigured ? t('computerUseHelperSet') : t('computerUseHelperUnset')}
            onEdit={(text) => { props.edit('backgroundHelper', text) }}
          />
        )
        : null}
      <p className={css.note} role="note">{t('computerUseLiveHint')}</p>
    </PluginCard>
  )
}
