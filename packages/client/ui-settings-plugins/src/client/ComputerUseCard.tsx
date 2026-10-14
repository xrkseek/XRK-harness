/** Desktop computer-use card (Face `computer-use`: off / UIA / background + helper). */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { SecretField, SelectField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import { modeMasterSwitch } from './plugin-master-switch.ts'
import type { ComputerUseCardFace } from './computer-use-card-controller.ts'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

/** Props the renderer binds for the computer-use card. */
export type ComputerUseCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<ComputerUseCardFace>

function modeBadgeKey(mode: string): PluginsSettingsLocaleKey {
  if (mode === 'uia') return 'computerUseModeUia'
  if (mode === 'background') return 'computerUseModeBackground'
  return 'computerUseModeOff'
}

function modeDetailKey(mode: string): PluginsSettingsLocaleKey {
  if (mode === 'uia') return 'computerUseDetailUia'
  if (mode === 'background') return 'computerUseDetailBackground'
  return 'computerUseDetailOff'
}

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
      badge={mode === 'off' ? undefined : t(modeBadgeKey(mode))}
      masterSwitch={modeMasterSwitch(mode, (value) => { props.edit('mode', value) }, 'uia')}
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
      <p className={css.note} role="note">{t(modeDetailKey(mode))}</p>
      <p className={css.note} role="note">{t('computerUseLiveHint')}</p>
    </PluginCard>
  )
}
