/** 向日葵免费 egress card (Face `sunflower-free`: OpenCode + Kilo proxy). */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { SunflowerFreeCardFace } from './sunflower-free-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

/** Props the renderer binds for the sunflower-free card. */
export type SunflowerFreeCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<SunflowerFreeCardFace>

/**
 * Render the sunflower-free egress card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function SunflowerFreeCard(props: SunflowerFreeCardProps) {
  const { t } = props
  const state = props.useSunflowerFreeCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="sunflowerFreeTitle"
      descriptionKey="sunflowerFreeDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ValueField
        id="plugin-config-sunflower-free-opencode-proxy"
        label={t('sunflowerFreeOpenCodeProxy')}
        hint={t('sunflowerFreeOpenCodeProxyHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.openCodeProxy}
        onEdit={(text) => { props.edit('openCodeProxy', text) }}
        onReset={() => { props.resetField('openCodeProxy') }}
      />
      <ValueField
        id="plugin-config-sunflower-free-kilo-proxy"
        label={t('sunflowerFreeKiloProxy')}
        hint={t('sunflowerFreeKiloProxyHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.kiloProxy}
        onEdit={(text) => { props.edit('kiloProxy', text) }}
        onReset={() => { props.resetField('kiloProxy') }}
      />
      <p className={css.note} role="note">{t('sunflowerFreeLiveHint')}</p>
    </PluginCard>
  )
}
