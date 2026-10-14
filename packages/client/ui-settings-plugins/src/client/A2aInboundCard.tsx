/** A2A inbound card (Face `a2a-inbound`): Agent Card + message/send → Face inject. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import { booleanMasterSwitch } from './plugin-master-switch.ts'
import type { A2aInboundCardFace } from './a2a-inbound-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './McpCard.module.css'

/** Props the renderer binds for the a2a-inbound card. */
export type A2aInboundCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<A2aInboundCardFace>

/**
 * Render the A2A inbound card (opt-in public routes + Face session inject).
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function A2aInboundCard(props: A2aInboundCardProps) {
  const { t } = props
  const state = props.useA2aInboundCard(snapshot => snapshot)
  const disabled = !state.writable
  const enabled = state.enabled.text === 'true'
  return (
    <PluginCard
      t={t}
      titleKey="a2aInboundTitle"
      descriptionKey="a2aInboundDescription"
      state={state}
      masterSwitch={booleanMasterSwitch(enabled, (value) => { props.edit('enabled', value) })}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <p className={css.note} role="note">{t('a2aInboundEnabledHint')}</p>
      <ValueField
        id="plugin-config-a2a-inbound-session"
        label={t('a2aInboundSession')}
        hint={t('a2aInboundSessionHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled || !enabled}
        {...state.sessionId}
        onEdit={(text) => { props.edit('sessionId', text) }}
        onReset={() => { props.resetField('sessionId') }}
      />
      <ValueField
        id="plugin-config-a2a-inbound-timeout"
        label={t('a2aInboundTimeout')}
        hint={t('a2aInboundTimeoutHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled || !enabled}
        {...state.timeoutMs}
        onEdit={(text) => { props.edit('timeoutMs', text) }}
        onReset={() => { props.resetField('timeoutMs') }}
      />
      <p className={css.note} role="note">{t('a2aInboundLiveHint')}</p>
    </PluginCard>
  )
}
